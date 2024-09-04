import * as vscode from 'vscode';
import { TCPClientConnection, Message } from './TCPConnection';
import logger from '../logger';
import NoesisLanguageClient from './NoesisLanguageClient';

export interface AnnouncementMessage {
	serverPort: number; // Deprecated
	serverName: string;
	serverPriority: number;
	canRenderPreview: boolean;
}

export enum NoesisConnectionStatus {
	INITIALIZING,
	CONNECTING,
	DISCONNECTED,
	CONNECTED,
}

export default class NoesisClient {

	private readonly _languageServerConnection: TCPClientConnection = new TCPClientConnection();

	private _context: vscode.ExtensionContext;
	private _announcementMessage: AnnouncementMessage;
	private _serverAddress: string;
	private _serverPort: number;
	private _languageClient: NoesisLanguageClient = null;
	private _languageClientDispose: vscode.Disposable = null;
	private _status : NoesisConnectionStatus = NoesisConnectionStatus.INITIALIZING;
	private _statusChangedCallbacks: ((value : NoesisConnectionStatus)=>void)[] = [];

	public get status() : NoesisConnectionStatus { return this._status; }
	public set status(value : NoesisConnectionStatus) {
		if (this._status != value) {
			this._status = value;
			for (const callback of this._statusChangedCallbacks) {
				callback(value);
			}
		}
	}

	public get languageClient() : NoesisLanguageClient { return this._languageClient; }
	public get announcementMessage() : AnnouncementMessage { return this._announcementMessage; }
	public get connectionStatus() : NoesisConnectionStatus { return this.status; }
	public get serverAddress() : string { return this._serverAddress; }
	public get serverPort() : number { return this._serverPort; }

	public addConnectionStatusListener(callback: (v : NoesisConnectionStatus)=>void) {
		if (this._statusChangedCallbacks.indexOf(callback) == -1) {
			this._statusChangedCallbacks.push(callback);
		}
	}

	constructor(context: vscode.ExtensionContext, announcementMessage: AnnouncementMessage, serverAddress: string, serverPort: number) {
		this._context = context;
		this._announcementMessage = announcementMessage;
		this._serverAddress = serverAddress;
		this._serverPort = serverPort;

		this._languageServerConnection.on('connected', this.onConnected.bind(this));
		this._languageServerConnection.on('disconnected', this.onDisconnected.bind(this));
		this._languageServerConnection.on('message', this.onReceivedMessage.bind(this));
		this._languageServerConnection.on('send_message', this.onSendingMessage.bind(this));
	}

	start() {								
		logger.log('[client]', `Connecting to serverName '${this._announcementMessage.serverName}' at ${this._serverAddress}:${this._serverPort} - serverPriority: ${this._announcementMessage.serverPriority}`);
		this.status = NoesisConnectionStatus.CONNECTING;
		this._languageServerConnection.connect(this._serverAddress, this._serverPort);		
	}

	stop(error?: Error) {
		if (this.status != NoesisConnectionStatus.DISCONNECTED)
		{
			this._languageServerConnection.disconnect(error);
		}
	}

	private onSendingMessage(message: Message) {		
		logger.log('[client]', JSON.stringify(message));
	}

	private onReceivedMessage(message: Message) {
		logger.log('[server]', JSON.stringify(message));		
	}

	private onConnected() {		
		this._languageClient = new NoesisLanguageClient(this._context, this._languageServerConnection.reader, this._languageServerConnection.writer);
		this._languageClientDispose = this._languageClient.start();
		this.status = NoesisConnectionStatus.CONNECTED;
	}

	private onDisconnected() {
		if (this._languageClient != null)
		{
			this._languageClient.stop();
			this._languageClientDispose.dispose();
		}
		this.status = NoesisConnectionStatus.DISCONNECTED;
	}
}