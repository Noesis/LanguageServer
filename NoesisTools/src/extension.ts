import * as vscode from 'vscode';
import { ExtensionContext } from "vscode";
import { NoesisTools } from "./NoesisTools";

let tools: NoesisTools = null;

export async function activate(context: ExtensionContext) {
	tools = new NoesisTools(context);
	await tools.init();
}

export async function deactivate(): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		tools.dispose();
		resolve();
	});
}
