import * as vscode from "vscode";

export function getConfiguration(name: string, default_value: any = null) {
	return vscode.workspace.getConfiguration("noesisgui-tools").get(name, default_value) || default_value;
}

