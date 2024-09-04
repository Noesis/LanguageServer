import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
import { MessageReader, MessageWriter } from 'vscode-jsonrpc';

export default class NoesisLanguageClient extends LanguageClient {

	private _started : boolean = false;
	public get hasStarted() : boolean { return this._started; }

	constructor(context: vscode.ExtensionContext, reader: MessageReader, writer: MessageWriter) {
		super(
			'NoesisLanguageClient',
			() => {
				return new Promise((resolve, reject) => {
					resolve({
						reader: reader, 
						writer: writer
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
	}

	start(): vscode.Disposable {
		this._started = true;
		return super.start();
	}

	stop(): Promise<void> {
		this._started = false;
		return super.stop();
	}
}