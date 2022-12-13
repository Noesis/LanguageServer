import * as vscode from 'vscode';
import { integer, LanguageClient, RequestMessage } from 'vscode-languageclient/node';
import { getConfiguration } from '../Utils';
import { TCPClientConnection, TCPConnectionStatus, Message } from './TCPConnection';
import logger from '../logger';

export default class NoesisLanguageClient extends LanguageClient {

	public readonly _languageServerConnection: TCPClientConnection = new TCPClientConnection();

	private _started : boolean = false;
	private _pendingMessages: Message[] = [];

	public get port() : integer { return this._languageServerConnection.port; }
	public get hasStarted() : boolean { return this._started; }
	public get connectionStatus() : TCPConnectionStatus { return this._languageServerConnection.status; }

	public addConnectionStatusListener(callback: (v : TCPConnectionStatus)=>void) {
		this._languageServerConnection.addStatusListener(callback); 
	}

	constructor(context: vscode.ExtensionContext) {
		super(
			'NoesisLanguageClient',
			() => {
				return new Promise((resolve, reject) => {
					resolve({
						reader: this._languageServerConnection.reader, 
						writer: this._languageServerConnection.writer
					});
				});
			},
			{
				documentSelector: [
					{ scheme: 'file', language: 'xaml' },
					{ scheme: 'untitled', language: 'xaml' },
				]
			}
		);
		this._languageServerConnection.on('connected', this.onConnected.bind(this));
		this._languageServerConnection.on('message', this.onReceivedMessage.bind(this));
		this._languageServerConnection.on('send_message', this.onSendingMessage.bind(this));		
	}

	connect() {	
		let host = getConfiguration('languageServerHost', '127.0.0.1');
		this._languageServerConnection.connect(host);
	}

	start(): vscode.Disposable {
		this._started = true;
		return super.start();
	}

	stop(): Promise<void> {
		this._started = false;
		this._languageServerConnection.disconnect();
		return super.stop();
	}

	private onSendingMessage(message: Message) {
		if (this._languageServerConnection.status != TCPConnectionStatus.CONNECTED)
		{
			this._pendingMessages.push(message);
			const requestMessage = message as RequestMessage;
			return;
		}
		
		logger.log('[client]', JSON.stringify(message));
	}

	private onReceivedMessage(message: Message) {
		logger.log('[server]', JSON.stringify(message));		
	}

	private onConnected() {
		this._pendingMessages.forEach(message => {
			this._languageServerConnection.writer.write(message);
		}); 
		this._pendingMessages = [];
	}
}