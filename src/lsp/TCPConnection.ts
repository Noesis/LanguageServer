import { AbstractMessageReader, MessageReader, DataCallback, Disposable } from 'vscode-jsonrpc';
import { EventEmitter } from 'events';
import { Socket } from 'net';
import * as dgram from 'dgram';
import * as vscode from 'vscode';

import MessageBuffer from './MessageBuffer';
import { AbstractMessageWriter, MessageWriter } from 'vscode-jsonrpc';
import { RequestMessage, ResponseMessage, NotificationMessage } from 'vscode-jsonrpc';
import { integer } from 'vscode-languageclient';
import logger from '../logger';

export type Message = RequestMessage | ResponseMessage | NotificationMessage;

export enum TCPConnectionStatus {
	WAITINGFORSERVER,
	PENDING,
	DISCONNECTED,
	CONNECTED,
}

export class TCPClientConnection extends EventEmitter {

	public readonly reader: TCPMessageReader = new TCPMessageReader(this);
	public readonly writer: TCPMessageWriter = new TCPMessageWriter(this);
	
	private _port: number;
	private _socket: Socket = null;
	private _status : TCPConnectionStatus = TCPConnectionStatus.WAITINGFORSERVER;
	private _statusChangedCallbacks: ((value : TCPConnectionStatus)=>void)[] = [];

	public get status() : TCPConnectionStatus { return this._status; }
	public set status(value : TCPConnectionStatus) {
		if (this._status != value) {
			this._status = value;
			for (const callback of this._statusChangedCallbacks) {
				callback(value);
			}
		}
	}

	public get port() : integer { return this._port; }

	protected destroyCurrentSocket(error?: Error) {
		this.status = TCPConnectionStatus.DISCONNECTED;
		if (this._socket != null)
		{
			this._socket.destroy(error);
			this._socket = null;
		}
	}

	public addStatusListener(callback: (v : TCPConnectionStatus)=>void) {
		if (this._statusChangedCallbacks.indexOf(callback) == -1) {
			this._statusChangedCallbacks.push(callback);
			callback(this.status);
		}
	}

	public sendMessage(message: string) {
		if (this._socket) {
			this._socket.write(message);
		}
	}

	async connect(host: string, port: number):Promise<void> {
		this.disconnect();
		this._port = port;
		this.status = TCPConnectionStatus.PENDING;
		return new Promise((resolve, reject) => {
								
			const socket = new Socket();
			socket.connect(port, host);
			socket.on('connect', ()=>{ this.onConnect(socket); resolve(); });
			socket.on('data', this.onReceiveMessage.bind(this));
			socket.on('end', this.onDisconnect.bind(this));
			socket.on('close', this.onDisconnect.bind(this));		
		});
	}

	public disconnect(error?: Error) {
		if (this.status != TCPConnectionStatus.WAITINGFORSERVER && this.status != TCPConnectionStatus.DISCONNECTED)
		{
			this.destroyCurrentSocket(error);
		}
	}

	protected onConnect(socket: Socket) {
		this._socket = socket;
		this.emit('connected');
		this.status = TCPConnectionStatus.CONNECTED;
	}

	protected onDisconnect() {
		this.destroyCurrentSocket();
		this.emit('disconnected');
	}

	protected onReceiveMessage(chunk: Buffer) {
		let message = chunk.toString();
		this.emit('data', message);
	}

	onSendMessage(message: any) {
		this.emit('send_message', message);
	}

	receiveMessage(message: any) {
		this.emit('message', message);
	}
}

class TCPMessageReader extends AbstractMessageReader implements MessageReader {

	private _connection: TCPClientConnection;
	private _callback: DataCallback;
	private _buffer: MessageBuffer;
	private _nextMessageLength: number;
	private _messageToken: number;
	private _partialMessageTimer: NodeJS.Timer | undefined;
	private _partialMessageTimeout: number;

	public constructor(connection: TCPClientConnection, encoding: BufferEncoding = 'utf8') {
		super();
		this._connection = connection;
		this._buffer = new MessageBuffer(encoding);
		this._partialMessageTimeout = 10000;
	}

	public set partialMessageTimeout(timeout: number) {
		this._partialMessageTimeout = timeout;
	}

	public get partialMessageTimeout(): number {
		return this._partialMessageTimeout;
	}

	public listen(callback: DataCallback): Disposable {
		this._nextMessageLength = -1;
		this._messageToken = 0;
		this._partialMessageTimer = undefined;
		this._callback = callback;
		this._connection.on('data', (data: Buffer) => {
			this.onData(data);
		});
		this._connection.on('error', (error: any) => this.fireError(error));
		this._connection.on('close', () => this.fireClose());
		
		return;
	}

	private onData(data: Buffer | String): void {
		this._buffer.append(data);
		while (true) {
			if (this._nextMessageLength === -1) {
				let headers = this._buffer.tryReadHeaders();
				if (!headers) {
					return;
				}
				let contentLength = headers['Content-Length'];
				if (!contentLength) {
					throw new Error('Header must provide a Content-Length property.');
				}
				let length = parseInt(contentLength);
				if (isNaN(length)) {
					throw new Error('Content-Length value must be a number.');
				}
				this._nextMessageLength = length;
				// Take the encoding form the header. For compatibility
				// treat both utf-8 and utf8 as node utf8
			}
			var msg = this._buffer.tryReadContent(this._nextMessageLength);
			if (msg === null) {
				/** We haven't received the full message yet. */
				this.setPartialMessageTimer();
				return;
			}
			this.clearPartialMessageTimer();
			this._nextMessageLength = -1;
			this._messageToken++;
			var json = JSON.parse(msg);
			this._callback(json);
			// callback
			this._connection.receiveMessage(json);
		}
	}

	private clearPartialMessageTimer(): void {
		if (this._partialMessageTimer) {
			clearTimeout(this._partialMessageTimer);
			this._partialMessageTimer = undefined;
		}
	}

	private setPartialMessageTimer(): void {
		this.clearPartialMessageTimer();
		if (this._partialMessageTimeout <= 0) {
			return;
		}
		this._partialMessageTimer = setTimeout((token, timeout) => {
			this._partialMessageTimer = undefined;
			if (token === this._messageToken) {
				this.firePartialMessage({ messageToken: token, waitingTime: timeout });
				this.setPartialMessageTimer();
			}
		}, this._partialMessageTimeout, this._messageToken, this._partialMessageTimeout);
	}
}

const ContentLength: string = 'Content-Length: ';
const CRLF = '\r\n';
class TCPMessageWriter extends AbstractMessageWriter implements MessageWriter {

	private _connection: TCPClientConnection;
	private _encoding: BufferEncoding;
	private _errorCount: number;

	public constructor(connection: TCPClientConnection, encoding: BufferEncoding = 'utf8') {
		super();
		this._connection = connection;
		this._encoding = encoding;
		this._errorCount = 0;
		this._connection.on('error', (error: any) => this.fireError(error));
		this._connection.on('close', () => this.fireClose());
	}
	
	public end(): void {
		
	}

	public write(msg: Message): Promise<void> {
		let json = JSON.stringify(msg);
		let contentLength = Buffer.byteLength(json, this._encoding);

		let headers: string[] = [
			ContentLength, contentLength.toString(), CRLF,
			CRLF
		];
		try {
			// callback
			this._connection.onSendMessage(msg);
			// Header must be written in ASCII encoding
			this._connection.sendMessage(headers.join(''));
			// Now write the content. This can be written in any encoding
			this._connection.sendMessage(json);
			this._errorCount = 0;
		} catch (error) {
			this._errorCount++;
			this.fireError(error, msg, this._errorCount);
		}
		
		return;
	}
}
