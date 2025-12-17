import * as vscode from "vscode";
import { ZenMuxChatModelProvider } from "./provider";
import { initStatusBar } from "./statusBar";

export function activate(context: vscode.ExtensionContext) {
	// Build a descriptive User-Agent to help quantify API usage
	const ext = vscode.extensions.getExtension("zenmux.zenmux-copilot");
	const extVersion = ext?.packageJSON?.version ?? "unknown";
	const vscodeVersion = vscode.version;
	// Keep UA minimal: only extension version and VS Code version
	const ua = `zenmux-copilot/${extVersion} VSCode/${vscodeVersion}`;

	const tokenCountStatusBarItem: vscode.StatusBarItem = initStatusBar(context);
	// Create an output channel for logging and add it to subscriptions so it is disposed with the extension
	const output = vscode.window.createOutputChannel("ZenMux");
	context.subscriptions.push(output);

	const provider = new ZenMuxChatModelProvider(context.secrets, ua, tokenCountStatusBarItem, output);
	// Register the ZenMux provider under the vendor id used in package.json
	vscode.lm.registerLanguageModelChatProvider("zenmux", provider);

	output.appendLine("ZenMux Chat Model Provider activated.");

	// Management command to configure API key
	context.subscriptions.push(
		vscode.commands.registerCommand("zenmux.setApikey", async () => {
			const existing = await context.secrets.get("zenmux.apiKey");
			const apiKey = await vscode.window.showInputBox({
				title: "ZenMux Provider API Key",
				prompt: existing ? "Update your ZenMux API key" : "Enter your ZenMux API key",
				ignoreFocusOut: true,
				password: true,
				value: existing ?? "",
			});
			if (apiKey === undefined) {
				return; // user canceled
			}
			if (!apiKey.trim()) {
				await context.secrets.delete("zenmux.apiKey");
				vscode.window.showInformationMessage("OAI Compatible API key cleared.");
				return;
			}
			await context.secrets.store("zenmux.apiKey", apiKey.trim());
			vscode.window.showInformationMessage("ZenMux API key saved.");
		})
	);
}

export function deactivate() {}
