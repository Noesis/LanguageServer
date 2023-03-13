import * as vscode from 'vscode';
import { Position, TextDocument, Uri } from 'vscode';
import { RequestType, TextDocumentIdentifier, NotificationType, Position as LspPosition, integer, CompletionRequest } from 'vscode-languageclient';
import logger from './logger';
import * as os from 'os';
import * as cp from 'child_process'
import * as path from 'path'
import * as dgram from 'dgram';
import NoesisLanguageClient from './lsp/NoesisLanguageClient';
import { TCPConnectionStatus } from './lsp/TCPConnection';
import { getConfiguration } from './Utils';
import { activateAutoInsertion, AutoInsertResult, HasCompletionItemsResult } from './autoInsertion';
import { activateRunDiagnostics } from './runDiagnostics';
import { Func } from 'mocha';

interface AutoInsertParams {
	/**
	 * The auto insert kind
	 */
	kind: 'autoQuote' | 'autoClose';
	/**
	 * The text document.
	 */
	textDocument: TextDocumentIdentifier;
	/**
	 * The position inside the text document.
	 */
	position: LspPosition;
}

interface AnnouncementMessage {	
	serverPort: number;
	serverName: string;
	serverPriority: number;
}

namespace AutoInsertRequest {
	export const type: RequestType<AutoInsertParams, AutoInsertResult, any> = new RequestType('xaml/autoInsert');
}

interface HasCompletionItemsParams {
	/**
	 * The text document.
	 */
	textDocument: TextDocumentIdentifier;
	/**
	 * The position inside the text document.
	 */
	position: LspPosition;
}

namespace HasCompletionItemsRequest {
	export const type: RequestType<HasCompletionItemsParams, HasCompletionItemsResult, any> = new RequestType('textDocument/hasCompletion');
}

interface RunDiagnosticsParams {
	/**
	 * Preview render width
	 */
	previewRenderWidth: integer;
	/**
	 * Preview render height
	 */
	previewRenderHeight: integer;
	/**
	 * Preview render time
	 */
	previewRenderTime: number;
}

namespace RunDiagnosticsNotification {
	export const type: NotificationType<RunDiagnosticsParams> = new NotificationType('xaml/runDiagnostics');
}

export class NoesisTools {
	private _context: vscode.ExtensionContext;
	private _languageClient: NoesisLanguageClient = null;
	private _languageClientDispose: vscode.Disposable = null;
	private _autoReconnect = false;
	private _reconnectAttemptCount = 0;
	private _connectionStatusBar: vscode.StatusBarItem = null;
	private _noesisPath: Uri = null;
	private _intervals: Array<NodeJS.Timeout> = new Array<NodeJS.Timeout>();
	private _serverProcess: cp.ChildProcess;
	private _announcementSocket: dgram.Socket = null;
	private _announcementMessage: AnnouncementMessage;
	private _hadExternalConnection: boolean = false;
	public previewPanel: vscode.WebviewPanel = null;
	public runDiagnosticsCallback: Function;

	constructor(context: vscode.ExtensionContext) {
		this._context = context;
	}

	public async init() {
		let commands = vscode.commands.getCommands();

		vscode.commands.registerCommand('noesisTool.checkConnectionStatus', this.checkConnectionStatus.bind(this));

		this._connectionStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);	
		this._connectionStatusBar.text = `$(sync) Initializing`;
		this._connectionStatusBar.command = 'noesisTool.checkConnectionStatus';
		this._connectionStatusBar.show();

		let context = this._context;
		let noesisTools = this;
		
		const insertRequestor = (kind: 'autoQuote' | 'autoClose', document: TextDocument, position: Position): Promise<AutoInsertResult> => {
			const param: AutoInsertParams = {
				kind,
				textDocument: this._languageClient.code2ProtocolConverter.asTextDocumentIdentifier(document),
				position: this._languageClient.code2ProtocolConverter.asPosition(position)
			};
			return this._languageClient.sendRequest(AutoInsertRequest.type, param);
		};			
		const hasCompletionItemsRequestor = (document: TextDocument, position: Position): Promise<HasCompletionItemsResult> => {
			const param: HasCompletionItemsParams = {
				textDocument: this._languageClient.code2ProtocolConverter.asTextDocumentIdentifier(document),
				position: this._languageClient.code2ProtocolConverter.asPosition(position)
			};
			return this._languageClient.sendRequest(HasCompletionItemsRequest.type, param);
		};	
		this._context.subscriptions.push(activateAutoInsertion(this, insertRequestor, hasCompletionItemsRequestor));
		
		let previewPanelWidth: integer = 0;
		let previewPanelHeight: integer = 0;

		const diagnosticsRequestor = () => {
			const param: RunDiagnosticsParams = {
				previewRenderWidth: previewPanelWidth,
				previewRenderHeight: previewPanelHeight,
				previewRenderTime: getConfiguration('xamlPreviewRenderTime', 0)
			};
			this._languageClient.sendNotification(RunDiagnosticsNotification.type, param);
		};

		vscode.workspace.onDidChangeConfiguration(event => {
			const diagnosticsEffected = event.affectsConfiguration("noesisgui-tools.xamlPreviewRenderTime");
			if (diagnosticsEffected) {
				diagnosticsRequestor();
			}
			const clientAffected = event.affectsConfiguration("noesisgui-tools.createLanguageServerInstance")
				|| event.affectsConfiguration("noesisgui-tools.languageServerPath")
				|| event.affectsConfiguration("noesisgui-tools.languageServerArgs")
				|| event.affectsConfiguration("noesisgui-tools.languageServerHost")
				|| event.affectsConfiguration("noesisgui-tools.reconnectAutomatically")
				|| event.affectsConfiguration("noesisgui-tools.reconnectDelay")
				|| event.affectsConfiguration("noesisgui-tools.reconnectAttempts");
			if (clientAffected)
			{
				this.createLanguageClient();
			}
		});
	
		this._context.subscriptions.push(activateRunDiagnostics(diagnosticsRequestor, this));

		vscode.commands.registerCommand('noesisTool.tryTriggerSuggest', async function (event) {	
			const activeEditor = vscode.window.activeTextEditor;
			if (activeEditor && activeEditor.document.languageId == "xaml") {
				hasCompletionItemsRequestor(activeEditor.document, activeEditor.selection.start).then(result => {
					// const provider = noesisTools.GetLanguageClientFeature(lsclient.CompletionRequest.method).getProvider(document);
					// provider.provideCompletionItems(document, cursorPosition, new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: '<' });
					if (result.items.length > 0) {
						vscode.commands.executeCommand('editor.action.triggerSuggest');
					}
				});
			}
		});

		vscode.commands.registerCommand('noesisTool.openPreview', async function (event) {
			if (noesisTools._announcementMessage != null && noesisTools._announcementMessage.serverName != "Embedded")
			{				
				vscode.window.showInformationMessage(`Preview is not available on external language servers (Unity / Unreal)`);
				return;
			}
			if (noesisTools.previewPanel == null)
			{
				noesisTools.previewPanel = vscode.window.createWebviewPanel(
					'noesisPreview',
					"XAML Preview",
					{
						preserveFocus: true,
						viewColumn: vscode.ViewColumn.Two
					},
					{
						// Enable scripts in the webview
						enableScripts: true
					}
				);					
	
				noesisTools.previewPanel.onDidDispose(
					() => {
						noesisTools.previewPanel = null;
					},
					null,
					context.subscriptions
				);
				
				// Handle messages from the webview
				noesisTools.previewPanel.webview.onDidReceiveMessage(
				  message => {
					switch (message.command) {
					  case 'resize':
						const size = message.text.split(",");
						const width = parseInt(size[0]);
						const height = parseInt(size[1]);
						if (width != previewPanelWidth || height != previewPanelHeight)
						{
							//vscode.window.showErrorMessage(`${size[0]} x ${size[1]}`);
							previewPanelWidth = width;
							previewPanelHeight = height;
							noesisTools.runDiagnosticsCallback();
						}
						return;
					}
				  },
				  undefined,
				  context.subscriptions
				);
				}
		});			

		let getEmptyWebviewContent = ($message) => {
			return `<!DOCTYPE html>
				<html lang="en">
				<head>
					<meta charset="UTF-8">
					<meta name="viewport" content="height=device-height, initial-scale=1.0">
					<title>XAML Preview</title>
				</head>
				<body style="overflow: hidden;">
					<script>
						(function() {
							const vscode = acquireVsCodeApi();

							window.addEventListener('resize', function(event) {
								vscode.postMessage({
									command: 'resize',
									text: window.innerWidth + ',' + window.innerHeight
								})
							}, true);
							
							vscode.postMessage({
								command: 'resize',
								text: window.innerWidth + ',' + window.innerHeight
							})
						}())
					</script>
					<div style="height: 100vh; width: 100%;">
						<div style="position: absolute; left: 50%; top: 50%;">
							<div style="margin-left: -50%; margin-top: -20px;">
								${$message} 
							</div>
						</div>
					</div>
				</body>
				</html>`;
		}

		let getWebviewContent = (imageUrl) => {
			return `<!DOCTYPE html>
				<html lang="en">
				<head>
					<meta charset="UTF-8">
					<meta name="viewport" content="height=device-height, initial-scale=1.0">
					<title>XAML Preview</title>
				</head>
				<body style="overflow: hidden; background-color: #20282F; margin: 0px; padding: 0px;">
					<script>
						(function() {
							const vscode = acquireVsCodeApi();

							window.addEventListener('resize', function(event) {
								vscode.postMessage({
									command: 'resize',
									text: window.innerWidth + ',' + window.innerHeight
								})
							}, true);
							
							vscode.postMessage({
								command: 'resize',
								text: window.innerWidth + ',' + window.innerHeight
							})
						}())
					</script>
					<div style="height: 100vh; width: 100%; margin: 0px; padding: 0px;">
						<img src="${imageUrl}" style="height: 100%; width: 100%; object-fit: contain;" />
					</div>
				</body>
				</html>`;
		}	
		
		let imageUri : string = null; //Uri = null;
	
		const updateWebview = async function () {
			const activeEditor = vscode.window.activeTextEditor;
			if (activeEditor && activeEditor.document.languageId == "xaml") {	

				let tmpDir;
				let sep;
				if (process.platform === "win32")
				{
					tmpDir = os.tmpdir();
					sep = "\\";
				}
				else
				{
					tmpDir = "/tmp";					
					sep = "/";
				}
				let previewFilePath = activeEditor.document.uri.fsPath;
				if (activeEditor.document.uri.scheme == "untitled")
				{
					previewFilePath = `a:${sep}untitled:` + previewFilePath;
				}
				while (previewFilePath.indexOf(sep) !== -1)
				{
					if (previewFilePath.indexOf(sep) === 0)
					{
						previewFilePath = previewFilePath.replace(sep, "");
					}
					else
					{
						previewFilePath = previewFilePath.replace(sep, "-_");
					}
				}
				while (previewFilePath.indexOf(":") !== -1)
				{
					previewFilePath = previewFilePath.replace(":", "_");
				}
				previewFilePath = `${tmpDir}${sep}noesis${sep}${previewFilePath}.png`;
				imageUri = previewFilePath;
				//imageUri = Uri.file(previewFilePath);
			}

			if (noesisTools.previewPanel == null)
			{
				previewPanelHeight = 0;
				previewPanelWidth = 0;
				return;
			}

			if (noesisTools.getConnectionStatus() != TCPConnectionStatus.CONNECTED)
			{
				noesisTools.previewPanel.webview.html = getEmptyWebviewContent("Connect to the NoesisGUI language server to begin previewing.");
				return;
			}

			if (imageUri != null)
			{
				try {	
					const fs = require('fs/promises');
					let imageBytesUtf8 = await fs.readFile(imageUri);			
					//let imageBytesUtf8 = await vscode.workspace.fs.readFile(imageUri);
					if (imageBytesUtf8.byteLength == 70)
					{									 
						noesisTools.previewPanel.webview.html = getEmptyWebviewContent("Fix errors in the XAML document to begin previewing.");
					}	
					else if (imageBytesUtf8.byteLength == 72)
					{									 
						noesisTools.previewPanel.webview.html = getEmptyWebviewContent("This XAML document does not contain a visual root.");
					}
					else
					{					 
						noesisTools.previewPanel.webview.html = getWebviewContent(`data:image/png;base64,${Buffer.from(imageBytesUtf8, 'binary').toString('base64')}`);
					}	
				} catch (error) {											 
					noesisTools.previewPanel.webview.html = getEmptyWebviewContent("A preview could not be found for this XAML document.");
				}
			}
			else
			{						 
				noesisTools.previewPanel.webview.html = getEmptyWebviewContent("View a XAML document to begin previewing.");
			}
			
		};			

		const bindSocket = (port: integer, callback: (announcementSocket: dgram.Socket, success: boolean) => void) : dgram.Socket => {
			const announcementSocket = dgram.createSocket('udp4');

			announcementSocket.on('error', (error) => {
				logger.log(error);
				callback(null, false);
			});

			announcementSocket.on('listening', () => {
				announcementSocket.setBroadcast(true);
				callback(announcementSocket, true);
			});

			announcementSocket.bind(port);

			return announcementSocket;
		};	
		
		const udpPortRangeBegin = 16629;
		const udpPortRangeEnd = 16649;

		let udpPort = udpPortRangeBegin;	

		const socketBindCallback = (announcementSocket: dgram.Socket, success: boolean) => {			

			if (!success)
			{
				udpPort++;
				if (udpPort > udpPortRangeEnd)
				{
					let errorMessage: string = `Failed to bind UDP announcement port between range ${udpPortRangeBegin} and ${udpPortRangeEnd}`;
					logger.log('[client]', errorMessage);
					vscode.window.showErrorMessage(errorMessage);
					return;
				}
				bindSocket(udpPort, socketBindCallback);
				return;
			}

			logger.log('[client]', `Bound to UDP announcement port ${udpPort}`);
			this._announcementSocket = announcementSocket;
			this._announcementSocket.on('message', (buffer, remote) => {				
				const message = buffer.toString('utf8');
				const announcementMessage: AnnouncementMessage = JSON.parse(message);

				if (this._announcementMessage != null && this._announcementMessage.serverPriority <= announcementMessage.serverPriority)
				{
					return;
				}
				
				if (!this._hadExternalConnection)
				{
					this._hadExternalConnection = announcementMessage.serverName != "Embedded";
				}

				this._announcementMessage = announcementMessage;

				if (isNaN(this._announcementMessage.serverPort))
				{
					logger.log('[client]', `Error: invalid server broadcast port '${message}'`);
					vscode.window.showErrorMessage('Invalid connection port broadcast from NoesisGUI server');
					return; 
				}		
								
				logger.log('[client]', `Connecting to serverName: '${this._announcementMessage.serverName}', serverPort: ${this._announcementMessage.serverPort}, serverPriority: ${this._announcementMessage.serverPriority}`);

				if (this._languageClient == null
					|| this._languageClient.connectionStatus == TCPConnectionStatus.PENDING
					|| this._languageClient.connectionStatus == TCPConnectionStatus.CONNECTED)
				{
					this.createLanguageClient();
				}
				this._languageClient.connect(this._announcementMessage.serverPort);
			});

		};

		bindSocket(udpPort, socketBindCallback);
		
		const openRenderPreview = getConfiguration('openRenderPreviewOnStart');
		if (openRenderPreview)
		{
			vscode.commands.executeCommand('noesisTool.openPreview');
		}

		await updateWebview();							
		this._intervals.push(setInterval(updateWebview, 100)) ;						
		this._intervals.push(setInterval(() => {
			this.retryConnectCallback();
		}, getConfiguration('reconnectDelay')));

		this.createLanguageClient();
	}	

	public getConnectionStatus() : TCPConnectionStatus
	{
		if (this._languageClient == null)
		{
			return TCPConnectionStatus.DISCONNECTED;
		}

		return this._languageClient.connectionStatus;
	}

	public dispose() {
		this._intervals.forEach(interval => {
			clearInterval(interval);
		});
		this._intervals = new Array<NodeJS.Timeout>();

		this._languageClient.stop();
		this._languageClient = null;
		if (this._noesisPath != null)
		{			
			vscode.workspace.fs.delete(this._noesisPath, {
				recursive: true,
				useTrash: false
			});
		}
		if (this._languageClientDispose != null)
		{
			this._languageClientDispose.dispose();
			this._languageClientDispose = null;
		}		
		if (this._announcementSocket != null)
		{
			this._announcementSocket.close();
			this._announcementSocket = null;
		}
		if (this._serverProcess != null)
		{
			this._serverProcess.kill();
			this._serverProcess = null;
		}
	}

	private createLanguageClient()
	{						
		logger.log('[client]', `createLanguageClient`);
		if (this._languageClient != null)
		{
			this._languageClient.stop();
		}
		if (this._languageClientDispose != null)
		{
			this._languageClientDispose.dispose();
			this._languageClientDispose = null;
		}
		if (this._serverProcess != null)
		{
			this._serverProcess.kill();
			this._serverProcess = null;
		}
		
		if (getConfiguration('createLanguageServerInstance') && !this._hadExternalConnection)
		{
			let ext = vscode.extensions.getExtension('NoesisTechnologies.noesisgui-tools')
			let serverExecPath: string;

			const languageServerPath = getConfiguration('languageServerPath');
			if (languageServerPath)
			{
				serverExecPath = languageServerPath;
			}
			else if (process.platform === "win32")
			{				
				serverExecPath = path.join(ext.extensionPath, 'bin', 'windows_x86_64', 'App.LangServerTool.exe');
			}
			else
			{		
				const fs = require('fs');							
				serverExecPath = path.join(ext.extensionPath, 'bin', 'macos', 'App.LangServerTool');
				fs.chmodSync(serverExecPath, 0o755);
			}
			
			const configArgs: string[] = getConfiguration('languageServerArgs');	
			this._serverProcess = cp.execFile(serverExecPath, configArgs, (error: cp.ExecFileException, stdout: string, stderr: string) => {		
				if (error)
				{
					logger.log('[client]', `Server binary execution error message: '${error.message}', stdout: '${stdout}', stderr: '${stderr}'`);
				}		
			});

			if (this._serverProcess.stdout != null)
			{
				this._serverProcess.stdout.on('data', (data) => {
					console.log(`[server stdout]: ${data}`);
				});
				this._serverProcess.stdout.on('error', (data) => {
					console.log(`[server stdout error]: ${data}`);
				});
				this._serverProcess.stdout.on('close', (data) => {
					console.log(`[server stdout close]: ${data}`);
				});
				this._serverProcess.stdout.on('end', (data) => {
					console.log(`[server stdout end]: ${data}`);
				});
				this._serverProcess.stdout.on('resume', (data) => {
					console.log(`[server stdout resume]: ${data}`);
				});
			}
			else
			{
				logger.log('[client]', `serverExecPath '${serverExecPath}' has no stdout?`);
			}

			logger.log('[client]', `platform: '${process.platform}', serverExecPath: '${serverExecPath}'`);
		}

		this._languageClient = new NoesisLanguageClient(this._context);
		this._languageClient.addConnectionStatusListener(this.onConnectionStatusChanged.bind(this));
	}

	private checkConnectionStatus() {
		if (this._languageClient == null)
		{
			vscode.window.showErrorMessage('Cannot check connection status, awaiting initialization');
			return;
		}
		const host = getConfiguration('languageServerHost');
		const port = this._languageClient.port;
		switch (this._languageClient.connectionStatus) {
			case TCPConnectionStatus.PENDING:
				vscode.window.showInformationMessage(`Connecting to NoesisGUI language server '${this._announcementMessage.serverName}' at ${host}:${port}`);
				break;
			case TCPConnectionStatus.CONNECTED:
				vscode.window.showInformationMessage(`Connected to NoesisGUI language server '${this._announcementMessage.serverName}' at ${host}:${port}`);
				break;
			case TCPConnectionStatus.DISCONNECTED:
				this.createLanguageClient();
				break;
		}
	}

	private onConnectionStatusChanged(status: TCPConnectionStatus) {
		if (this._languageClient == null)
		{
			vscode.window.showErrorMessage('Cannot update connection status, awaiting initialization');
			return;
		}
		const host = getConfiguration('languageServerHost');
		const port = this._languageClient.port;
		switch (status) {
			case TCPConnectionStatus.WAITINGFORSERVER:
				this._connectionStatusBar.text = `$(sync) Noesis`;
				this._connectionStatusBar.tooltip = `Waiting for announcement from NoesisGUI language server`;
				break;
			case TCPConnectionStatus.PENDING:
				this._connectionStatusBar.text = `$(sync) Noesis [${this._announcementMessage.serverName}]`;
				this._connectionStatusBar.tooltip = `Connecting to NoesisGUI language server '${this._announcementMessage.serverName}' at ${host}:${port}`;
				break;
			case TCPConnectionStatus.CONNECTED:
				this._connectionStatusBar.text = `$(check) Noesis [${this._announcementMessage.serverName}]`;
				this._connectionStatusBar.tooltip = `Connected to NoesisGUI language server '${this._announcementMessage.serverName}' at ${host}:${port}`;				
				this.runDiagnosticsCallback();
				if (!this._languageClient.hasStarted) {
					this._languageClientDispose = this._languageClient.start();		
				}
				break;
			case TCPConnectionStatus.DISCONNECTED:	
				this._announcementMessage = null;		
				if (this._languageClient.hasStarted)
				{
					logger.log('[client]', `Client disconnected`);
					this.createLanguageClient();
				}	
			default:
				break;
		}
	}

	private retryConnectCallback() {		
		if (this._languageClient.connectionStatus != TCPConnectionStatus.DISCONNECTED) {
			return		
		}
		if (this._languageClient == null)
		{
			vscode.window.showInformationMessage('Awaiting initialization..');
			return;
		}
		const shouldRetry = getConfiguration('reconnectAutomatically');
		const maxRetryCount = getConfiguration('reconnectAttempts');
		if (shouldRetry && this._reconnectAttemptCount < maxRetryCount) {
			this._reconnectAttemptCount++;

			this._languageClient.connect(this._announcementMessage.serverPort);
			this._autoReconnect = true;
			return;
		}

		this._connectionStatusBar.text = `$(x) Disconnected`;
		this._connectionStatusBar.tooltip = `Disconnected from NoesisGUI language server.`;

		if (this._autoReconnect) {
			const host = getConfiguration('languageServerHost');
			const port = this._languageClient.port;
			const message = `Failed to connect to NoesisGUI language server at ${host}:${port}. Is the server running?`;
			vscode.window.showErrorMessage(message, 'Retry', 'Cancel').then(item => {
				if (item == 'Retry') {
					this._reconnectAttemptCount = 0;
					this._autoReconnect = true;
					this._languageClient.connect(this._announcementMessage.serverPort);
				}
			});
		}

		this._autoReconnect = false
	}
}
