/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *  Based on: https://github.com/angelozerr/vscode/blob/290f9196d6a1aad30240b8b1ce32b2c407baa743/extensions/html-language-features/client/src/autoInsertion.ts
 *--------------------------------------------------------------------------------------------*/

import { window, workspace, Disposable, TextDocument, Position, SnippetString, TextDocumentChangeEvent, TextDocumentChangeReason, TextDocumentContentChangeEvent, Selection } from 'vscode';
import * as lsclient from 'vscode-languageclient/node';
import * as vscode from 'vscode';
import { NoesisTools } from './NoesisTools';

export interface AutoInsertResult {
	snippet: string
}

export interface HasCompletionItemsResult {
	items: vscode.CompletionItem[]
}

export function activateAutoInsertion(noesisTools: NoesisTools, 
	requestProvider: (kind: 'autoQuote' | 'autoClose', document: TextDocument, position: Position) => Thenable<AutoInsertResult>,
	hasCompletionItemsRequestProvider: (document: TextDocument, position: Position) => Thenable<HasCompletionItemsResult>): Disposable {
	const disposables: Disposable[] = [];
	workspace.onDidChangeTextDocument(onDidChangeTextDocument, null, disposables);

	let anyIsEnabled = false;
	const isEnabled = {
		'autoQuote': false,
		'autoClose': false
	};
	updateEnabledState();
	window.onDidChangeActiveTextEditor(updateEnabledState, null, disposables);

	let timeout : NodeJS.Timeout = null;

	disposables.push({
		dispose: () => {
			clearTimeout(timeout);
		}
	});

	function updateEnabledState() {
		anyIsEnabled = false;
		const editor = window.activeTextEditor;
		if (!editor) {
			return;
		}
		const document = editor.document;
		const configurations = workspace.getConfiguration(undefined, document.uri);
		isEnabled['autoQuote'] = configurations.get<boolean>('noesisgui-tools.autoCreateQuotes') ?? false;
		isEnabled['autoClose'] = configurations.get<boolean>('noesisgui-tools.autoClosingTags') ?? false;
		anyIsEnabled = isEnabled['autoQuote'] || isEnabled['autoClose'];
	}

	function onDidChangeTextDocument({ document, contentChanges, reason }: TextDocumentChangeEvent) {
		if (contentChanges.length === 0 || reason === TextDocumentChangeReason.Undo || reason === TextDocumentChangeReason.Redo) {
			return;
		}
		const activeDocument = window.activeTextEditor && window.activeTextEditor.document;
		if (document !== activeDocument || document.languageId != 'xaml') {
			return;
		}

		const lastChange = contentChanges[contentChanges.length - 1];

		if (lastChange.text === '{}')
		{
			vscode.commands.executeCommand('editor.action.triggerSuggest');
		}

		if (!anyIsEnabled)
		{
			return;
		}

		if (timeout != null) {
			clearTimeout(timeout);
			timeout = null;
		}

		if (isEnabled['autoQuote'] && lastChange.text === '=') {
			scheduleAutoInsert('autoQuote', document, lastChange);
		} else if (isEnabled['autoClose'] && (lastChange.text === '>' || lastChange.text === '/')) {
			scheduleAutoInsert('autoClose', document, lastChange);
		}
	}

	function scheduleAutoInsert(kind: 'autoQuote' | 'autoClose', document: TextDocument, lastChange: TextDocumentContentChangeEvent) {
		const rangeStart = lastChange.range.start;
		const version = document.version;
		timeout = setTimeout(() => {
			const position = new Position(rangeStart.line, rangeStart.character + lastChange.text.length);			
			requestProvider(kind, document, position).then(result => {
				if (result && isEnabled[kind]) {
					const activeEditor = window.activeTextEditor;
					if (activeEditor) {
						const activeDocument = activeEditor.document;
						if (document === activeDocument && activeDocument.version === version) {
							const selections = activeEditor.selections;
							if (selections.length && selections.some(s => s.active.isEqual(position))) {								
								activeEditor.insertSnippet(new SnippetString(result.snippet), selections.map(s => s.active));								
							} else {
								activeEditor.insertSnippet(new SnippetString(result.snippet), position);
							}
							let cursorPosition = position;
							if (kind == 'autoQuote')
							{
								cursorPosition = new Position(cursorPosition.line, cursorPosition.character + 1);
								setTimeout(() => {									
									hasCompletionItemsRequestProvider(document, cursorPosition).then(result => {
										// const provider = noesisTools.GetLanguageClientFeature(lsclient.CompletionRequest.method).getProvider(document);
										// provider.provideCompletionItems(document, cursorPosition, new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: '<' });
										if (result.items.length > 0) {
											vscode.commands.executeCommand('editor.action.triggerSuggest');
										}
									});
								}, 200);
							}
							else if (result.snippet == '>')
							{
								cursorPosition = new Position(cursorPosition.line, cursorPosition.character + 1);
							}
							else if (!result.snippet.startsWith('</'))
							{
								cursorPosition = new Position(cursorPosition.line, cursorPosition.character + result.snippet.length);
							}
							var newSelection = new Selection(cursorPosition, cursorPosition);
							activeEditor.selection = newSelection;
						}
					}
				}
			}, 
			(_reason: any) => {
				console.log('xaml/autoInsert request has been cancelled');
			});
			timeout = undefined;
		}, 100);
	}
	return Disposable.from(...disposables);
}
