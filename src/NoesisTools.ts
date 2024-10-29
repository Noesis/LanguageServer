import * as vscode from 'vscode';
import { Position, TextDocument, Uri } from 'vscode';
import { RequestType, TextDocumentIdentifier, NotificationType, Position as LspPosition, integer, CompletionRequest } from 'vscode-languageclient';
import logger from './logger';
import * as os from 'os';
import * as cp from 'child_process'
import * as path from 'path'
import * as dgram from 'dgram';
import NoesisClient, { NoesisConnectionStatus, AnnouncementMessage } from './lsp/NoesisClient';
import { getConfiguration } from './Utils';
import { activateAutoInsertion, AutoInsertResult, HasCompletionItemsResult } from './autoInsertion';
import { activateRunDiagnostics } from './runDiagnostics';

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
	private _client: NoesisClient = null;
	private _connectionStatusBar: vscode.StatusBarItem = null;
	private _noesisPath: Uri = null;
	private _intervals: Array<NodeJS.Timeout> = new Array<NodeJS.Timeout>();
	private _serverProcess: cp.ChildProcess;
	private _announcementSocket: dgram.Socket = null;
	private _hadExternalConnection: boolean = false;
	private _announcementPort: number = 0;
	public previewPanel: vscode.WebviewPanel = null;
	public runDiagnosticsCallback: Function;	

	constructor(context: vscode.ExtensionContext) {
		this._context = context;
	}

	public async init() {
		let commands = vscode.commands.getCommands();

		vscode.commands.registerCommand('noesisTool.checkConnectionStatus', this.checkConnectionStatus.bind(this));

		this._connectionStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);	
		this._connectionStatusBar.text = `$(x) Disconnected`;
		this._connectionStatusBar.command = 'noesisTool.checkConnectionStatus';
		this._connectionStatusBar.show();

		let context = this._context;
		let noesisTools = this;
		
		const insertRequestor = (kind: 'autoQuote' | 'autoClose', document: TextDocument, position: Position): Promise<AutoInsertResult> => {
			if (this.getConnectionStatus() != NoesisConnectionStatus.CONNECTED)
			{
				return null;
			}
			const param: AutoInsertParams = {
				kind,
				textDocument: this._client.languageClient.code2ProtocolConverter.asTextDocumentIdentifier(document),
				position: this._client.languageClient.code2ProtocolConverter.asPosition(position)
			};
			return this._client.languageClient.sendRequest(AutoInsertRequest.type, param);
		};			
		const hasCompletionItemsRequestor = (document: TextDocument, position: Position): Promise<HasCompletionItemsResult> => {
			if (this.getConnectionStatus() != NoesisConnectionStatus.CONNECTED)
			{
				return null;
			}
			const param: HasCompletionItemsParams = {
				textDocument: this._client.languageClient.code2ProtocolConverter.asTextDocumentIdentifier(document),
				position: this._client.languageClient.code2ProtocolConverter.asPosition(position)
			};
			return this._client.languageClient.sendRequest(HasCompletionItemsRequest.type, param);
		};	
		this._context.subscriptions.push(activateAutoInsertion(this, insertRequestor, hasCompletionItemsRequestor));
		
		let previewPanelWidth: integer = 0;
		let previewPanelHeight: integer = 0;

		const diagnosticsRequestor = () => {
			if (this.getConnectionStatus() != NoesisConnectionStatus.CONNECTED)
			{
				return null;
			}
			const param: RunDiagnosticsParams = {
				previewRenderWidth: previewPanelWidth,
				previewRenderHeight: previewPanelHeight,
				previewRenderTime: getConfiguration('xamlPreviewRenderTime', 0)
			};
			this._client.languageClient.sendNotification(RunDiagnosticsNotification.type, param);
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
				if (this._client != null)
				{
					this._client.stop();
					this._client = null;
				}		
				else
				{
					this.trySpawnServerProcess();
				}
			}
		});
	
		this._context.subscriptions.push(activateRunDiagnostics(diagnosticsRequestor, this));

		vscode.commands.registerCommand('noesisTool.tryTriggerSuggest', async function (event) {	
			const activeEditor = vscode.window.activeTextEditor;
			if (activeEditor && activeEditor.document.languageId == "xaml") {
				hasCompletionItemsRequestor(activeEditor.document, activeEditor.selection.start).then(result => {
					if (result.items.length > 0) {
						vscode.commands.executeCommand('editor.action.triggerSuggest');
					}
				});
			}
		});

		vscode.commands.registerCommand('noesisTool.openPreview', async function (event) {
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
		
		let imageUri : string = null;
	
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
					previewFilePath = `zuntitledz${sep}` + previewFilePath;
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
			}

			if (noesisTools.previewPanel == null)
			{
				previewPanelHeight = 0;
				previewPanelWidth = 0;
				return;
			}

			if (noesisTools.getConnectionStatus() != NoesisConnectionStatus.CONNECTED)
			{
				noesisTools.previewPanel.webview.html = getEmptyWebviewContent("Connect to a NoesisGUI Language Server to begin previewing.");
				return;
			}

			if (!noesisTools._client.announcementMessage.canRenderPreview)
			{
				noesisTools.previewPanel.webview.html = getEmptyWebviewContent(`${noesisTools._client.announcementMessage.serverName} Language Server does not support previews.`);
				return;
			}

			if (imageUri != null)
			{
				try {	
					const fs = require('fs/promises');
					let imageBytesUtf8 = await fs.readFile(imageUri);

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

		this._announcementPort = udpPortRangeBegin;

		const socketBindCallback = (announcementSocket: dgram.Socket, success: boolean) => {			

			if (!success)
			{
				this._announcementPort++;
				if (this._announcementPort > udpPortRangeEnd)
				{
					let errorMessage: string = `Failed to bind UDP announcement port between range ${udpPortRangeBegin} and ${udpPortRangeEnd}`;
					logger.log('[client]', errorMessage);
					vscode.window.showErrorMessage(errorMessage);
					this._announcementPort = -1;
					return;
				}
				bindSocket(this._announcementPort, socketBindCallback);
				return;
			}			

			this.trySpawnServerProcess();

			logger.log('[client]', `Bound to announcement port: ${this._announcementPort}`);
			this._announcementSocket = announcementSocket;			
			this._announcementSocket.on('message', (buffer, remote) => {				
				const message = buffer.toString('utf8');
				const announcementMessage: AnnouncementMessage = JSON.parse(message);				

				if (this._client != null)
				{
					if (this._client.announcementMessage.serverPriority <= announcementMessage.serverPriority)
					{
						return;
					}

					this._client.stop();
				}

				const isEmbedded = announcementMessage.serverName == "Embedded";
				if (isEmbedded)
				{
					if (!getConfiguration('createLanguageServerInstance'))
					{
						return;
					}
				}
				else if (this._serverProcess != null)
				{
					this._serverProcess.kill();
					this._serverProcess = null;
				}
				
				if (!this._hadExternalConnection)
				{
					this._hadExternalConnection = !isEmbedded;
				}
				
				logger.log('[client]', `Accepted AnnouncementMessage: '${message}' from ${remote.address}:${remote.port}`);

				let address = remote.address;
				let port = remote.port;
				if (announcementMessage.serverPort > 0)
				{
					// Deprecated, remaining compatible with older LangServer versions
					address = "127.0.0.1";
					port = announcementMessage.serverPort;
				}
				
				this._client = new NoesisClient(context, announcementMessage, address, port);
				this._client.addConnectionStatusListener(this.onConnectionStatusChanged.bind(this));
				this._client.start();
			});			

			this.findServer();
			this._intervals.push(setInterval(this.findServer.bind(this), 1000));
		};

		bindSocket(this._announcementPort, socketBindCallback);
		
		const openRenderPreview = getConfiguration('openRenderPreviewOnStart', false);
		if (openRenderPreview)
		{
			vscode.commands.executeCommand('noesisTool.openPreview');
		}

		await updateWebview();
		this._intervals.push(setInterval(updateWebview, 100));
	}

	public getConnectionStatus() : NoesisConnectionStatus
	{
		if (this._client == null)
		{
			return NoesisConnectionStatus.DISCONNECTED;
		}

		return this._client.connectionStatus;
	}

	public dispose() {
		this._intervals.forEach(interval => {
			clearInterval(interval);
		});
		this._intervals = new Array<NodeJS.Timeout>();

		if (this._client != null)
		{
			this._client.stop();
			this._client = null;			
		}

		if (this._noesisPath != null)
		{			
			vscode.workspace.fs.delete(this._noesisPath, {
				recursive: true,
				useTrash: false
			});
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

	private findServer()
	{
		if (this._client == null && this._announcementSocket != null)
		{		
			const serverPortRangeBegin = 16529;
			const serverPortRangeEnd = 16549;

			for	(let serverPort = serverPortRangeBegin; serverPort <= serverPortRangeEnd; serverPort++)
			{
				this._announcementSocket.send("NoesisLangServer", serverPort, "127.0.0.1");
			}
		}
	}

	private trySpawnServerProcess()
	{						
		logger.log('[client]', `trySpawnServerProcess`);
		if (this._serverProcess != null)
		{
			this._serverProcess.kill();
			this._serverProcess = null;
		}
		
		if (getConfiguration('createLanguageServerInstance', false))
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
				if (fs.existsSync(serverExecPath)) {
					fs.chmodSync(serverExecPath, 0o755);
				}				
			}
			
			const configArgs: string[] = getConfiguration('languageServerArgs');
			configArgs.unshift(this._announcementPort.toString());
			configArgs.unshift("--port");
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

			logger.log('[client]', `platform: '${process.platform}', serverExecPath: '${serverExecPath}', args: '${configArgs.join(' ')}'`);
		}
	}

	private checkConnectionStatus() {
		if (this._client == null)
		{
			vscode.window.showInformationMessage('Disconnected from NoesisGUI Language Server.');
			return;
		}		

		const host = this._client.serverAddress;
		const port = this._client.serverPort;
		switch (this._client.connectionStatus) {
			case NoesisConnectionStatus.CONNECTING:
				vscode.window.showInformationMessage(`Connecting to ${host}:${port} - ${JSON.stringify(this._client.announcementMessage)}'`);
				break;
			case NoesisConnectionStatus.CONNECTED:
				vscode.window.showInformationMessage(`Connected to ${host}:${port} - ${JSON.stringify(this._client.announcementMessage)}'`);
				break;
			case NoesisConnectionStatus.DISCONNECTED:
				this.trySpawnServerProcess();
				break;
		}
	}

	private onConnectionStatusChanged(status: NoesisConnectionStatus) {
		if (this._client == null)
		{
			this._connectionStatusBar.text = `$(sync) Noesis`;
			this._connectionStatusBar.tooltip = `Waiting for announcement from NoesisGUI Language Server`;
			return;
		}
		const host = this._client.serverAddress;
		const port = this._client.serverPort;
		switch (status) {
			case NoesisConnectionStatus.INITIALIZING:
				this._connectionStatusBar.text = `$(sync) Noesis`;
				this._connectionStatusBar.tooltip = `Initializing connection to NoesisGUI Language Server '${this._client.announcementMessage.serverName}' at ${host}:${port}`;
				break;
			case NoesisConnectionStatus.CONNECTING:
				this._connectionStatusBar.text = `$(sync) Noesis [${this._client.announcementMessage.serverName}]`;
				this._connectionStatusBar.tooltip = `Connecting to NoesisGUI Language Server '${this._client.announcementMessage.serverName}' at ${host}:${port}`;
				break;
			case NoesisConnectionStatus.CONNECTED:
				this._connectionStatusBar.text = `$(check) Noesis [${this._client.announcementMessage.serverName}]`;
				this._connectionStatusBar.tooltip = `Connected to NoesisGUI Language Server '${this._client.announcementMessage.serverName}' at ${host}:${port}`;
				this.runDiagnosticsCallback();
				break;
			case NoesisConnectionStatus.DISCONNECTED:
				this._connectionStatusBar.text = `$(x) Disconnected`;
				this._connectionStatusBar.tooltip = `Disconnected from NoesisGUI Language Server.`;
				this._client.stop();
				this._client = null;
				this.findServer();
				this.trySpawnServerProcess();
			default:
				break;
		}
	}
}
