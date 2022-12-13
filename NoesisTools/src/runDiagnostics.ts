/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { window, workspace, Disposable, TextDocument, Position, SnippetString, TextDocumentChangeEvent, TextDocumentChangeReason, TextDocumentContentChangeEvent } from 'vscode';
import { integer } from 'vscode-languageclient';
import logger from './logger';
import { NoesisTools } from './NoesisTools';

export interface AutoInsertResult {
	snippet: string
  }

export function activateRunDiagnostics(requestProvider: () => void, noesisTools: NoesisTools): Disposable {
	const disposables: Disposable[] = [];
	workspace.onDidChangeTextDocument(onDidChangeTextDocument, null, disposables);
	workspace.onDidOpenTextDocument(onDidOpenTextDocument, null, disposables);
	workspace.onDidSaveTextDocument(onDidSaveTextDocument);
	noesisTools.runDiagnosticsCallback = triggerRunDiagnostics;

	const triggerEnabled = { 
		onChange: false,
		onSave: false
	};

	let delay: integer;
	let timeout : NodeJS.Timeout = null;

	updateEnabledState();
	window.onDidChangeActiveTextEditor(updateEnabledState, null, disposables);

	disposables.push({
		dispose: () => {
			clearTimeout(timeout);
		}
	});

	function updateEnabledState() {
		const editor = window.activeTextEditor;
		if (!editor) {
			return;
		}

		const document = editor.document;
		const configurations = workspace.getConfiguration(undefined, document.uri);

		let triggerCondition = configurations.get<string>('noesisgui-tools.diagnosticsTrigger');
		triggerEnabled.onChange = false;
		triggerEnabled.onSave = false;
		delay = 0;
		switch (triggerCondition)
		{
			case "onChange":
			{
				triggerEnabled.onChange = true;
				delay = configurations.get<integer>('noesisgui-tools.diagnosticsChangeDelay');
				break;
			}
			case "onSave":
			{
				triggerEnabled.onSave = true;
				break;
			}
		}
	}
	
	function triggerRunDiagnostics() {
		if (timeout != null) {
			clearTimeout(timeout);
			timeout = null;
		}		

		if (delay > 0)
		{
			timeout = setTimeout(() => {			
				logger.log('[client]', `runDiagnostics`);
				requestProvider();
				clearTimeout(timeout);
				timeout = null;
			}, delay);
		}
	}
	
	function onDidOpenTextDocument({ document }: any) {
		if (triggerEnabled.onChange || triggerEnabled.onSave)
		{
			triggerRunDiagnostics();
		}
	}
	
	function onDidSaveTextDocument() {
		if (triggerEnabled.onSave)
		{
			triggerRunDiagnostics();
		}
	}

	function onDidChangeTextDocument({ document, contentChanges, reason }: TextDocumentChangeEvent) {
		if (triggerEnabled.onChange && document.uri.scheme != 'output')
		{
			triggerRunDiagnostics();
		}
	}
	return Disposable.from(...disposables);
}
