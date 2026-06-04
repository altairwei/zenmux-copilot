import * as vscode from "vscode";

export const MANAGEMENT_API_KEY_SECRET = "zenmux.managementApiKey";

export async function getManagementApiKey(secrets: vscode.SecretStorage): Promise<string | undefined> {
	return secrets.get(MANAGEMENT_API_KEY_SECRET);
}

export async function promptForManagementApiKey(secrets: vscode.SecretStorage): Promise<string | undefined> {
	const existing = await getManagementApiKey(secrets);
	const apiKey = await vscode.window.showInputBox({
		title: "ZenMux Management API Key",
		prompt: existing ? "Update your ZenMux Management API Key" : "Enter your ZenMux Management API Key",
		ignoreFocusOut: true,
		password: true,
		value: existing ?? "",
	});

	if (apiKey === undefined) {
		return undefined;
	}

	const trimmed = apiKey.trim();
	if (!trimmed) {
		await clearManagementApiKey(secrets);
		vscode.window.showInformationMessage("ZenMux Management API Key cleared.");
		return undefined;
	}

	return trimmed;
}

export async function saveManagementApiKey(
	secrets: vscode.SecretStorage,
	apiKey: string
): Promise<void> {
	await secrets.store(MANAGEMENT_API_KEY_SECRET, apiKey);
}

export async function clearManagementApiKey(secrets: vscode.SecretStorage): Promise<void> {
	await secrets.delete(MANAGEMENT_API_KEY_SECRET);
}
