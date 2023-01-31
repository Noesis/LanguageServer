import * as vscode from 'vscode';

export class Logger {
	protected buffer: string = "";
	protected tag: string = '';
	protected time: boolean = false;
	protected outputChannel: vscode.OutputChannel;
	
	constructor(tag: string, channelName: string, time: boolean) {
		this.tag = tag;
		this.time = time;
		
		//Create output channel
		this.outputChannel = vscode.window.createOutputChannel(channelName);	
	}
	
	clear() {
		this.buffer = "";
	}
	
	log(...messages) {
		//if (process.env.VSCODE_DEBUG_MODE !== "true") {
		//	return;
		//}

		let line = '';
		if (this.tag) {
			line += `[${this.tag}]`;
		}
		if (this.time) {
			line += `[${new Date().toISOString()}]`;
		}
		if (line) {
			line += ' ';
		}
		
		for (let index = 0; index < messages.length; index++) {
			line += messages[index];
			if (index < messages.length) {
				line += " ";
			} else {
				line += "\n";
			}
		}
		
		this.buffer += line;
		console.log(line);

		this.outputChannel.appendLine(line);
	}
	
	get_buffer(): string {
		return this.buffer;
	}
}

const logger = new Logger('noesisgui-tools', 'NoesisGUI Tools', true);
export default logger;
