import * as vscode from "vscode";
import { fetchSubscriptionDetail, SubscriptionDetail, SubscriptionQuota } from "./managerApi";
import {
	clearManagementApiKey,
	getManagementApiKey,
	promptForManagementApiKey,
	saveManagementApiKey,
} from "./managerKey";

type UsageState =
	| { type: "not_configured" }
	| { type: "loading" }
	| { type: "ready"; detail: SubscriptionDetail; updatedAt: number }
	| { type: "error"; message: string; lastReady?: { detail: SubscriptionDetail; updatedAt: number } };

const MIN_REFRESH_INTERVAL_MS = 60_000;
const SUBSCRIPTION_DOC_URL = "https://zenmux.ai/docs/api/platform/subscription-detail.html";

export class SubscriptionStatusBar {
	private readonly statusBarItem: vscode.StatusBarItem;
	private state: UsageState = { type: "not_configured" };
	private lastRefreshStartedAt = 0;
	private refreshPromise: Promise<void> | undefined;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly userAgent: string,
		private readonly output: vscode.OutputChannel
	) {
		this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
		this.statusBarItem.name = "ZenMux Subscription";
		this.statusBarItem.command = "zenmux.showSubscriptionUsage";
		this.context.subscriptions.push(this.statusBarItem);
		this.render();
		this.statusBarItem.show();
	}

	async initialize(): Promise<void> {
		const apiKey = await getManagementApiKey(this.context.secrets);
		if (!apiKey) {
			this.state = { type: "not_configured" };
			this.render();
			return;
		}
		setTimeout(() => {
			this.refresh({ force: true, silent: true }).catch((error) => this.logError("Initial usage refresh failed", error));
		}, 3000);
	}

	async setManagementApiKey(): Promise<void> {
		const apiKey = await promptForManagementApiKey(this.context.secrets);
		if (!apiKey) {
			this.state = await getManagementApiKey(this.context.secrets) ? this.state : { type: "not_configured" };
			this.render();
			return;
		}

		this.state = { type: "loading" };
		this.render();
		try {
			const detail = await fetchSubscriptionDetail(apiKey, this.userAgent);
			await saveManagementApiKey(this.context.secrets, apiKey);
			this.state = { type: "ready", detail, updatedAt: Date.now() };
			vscode.window.showInformationMessage("ZenMux Management API Key saved.");
		} catch (error) {
			const message = this.getErrorMessage(error);
			this.state = { type: "error", message };
			vscode.window.showErrorMessage(`Manager key verification failed: ${message}`);
		}
		this.render();
	}

	async clearManagementApiKey(): Promise<void> {
		await clearManagementApiKey(this.context.secrets);
		this.state = { type: "not_configured" };
		this.render();
		vscode.window.showInformationMessage("ZenMux Management API Key cleared.");
	}

	async refreshAfterChatRequest(): Promise<void> {
		await this.refresh({ force: false, silent: true });
	}

	async refresh(options: { force: boolean; silent: boolean }): Promise<void> {
		const apiKey = await getManagementApiKey(this.context.secrets);
		if (!apiKey) {
			this.state = { type: "not_configured" };
			this.render();
			return;
		}

		const now = Date.now();
		if (!options.force && now - this.lastRefreshStartedAt < MIN_REFRESH_INTERVAL_MS) {
			return;
		}
		if (this.refreshPromise) {
			return this.refreshPromise;
		}

		const lastReady = this.getLastReadyState();
		this.lastRefreshStartedAt = now;
		this.state = { type: "loading" };
		this.render();

		this.refreshPromise = fetchSubscriptionDetail(apiKey, this.userAgent)
			.then((detail) => {
				this.state = { type: "ready", detail, updatedAt: Date.now() };
			})
			.catch((error) => {
				const message = this.getErrorMessage(error);
				this.state = { type: "error", message, lastReady };
				this.logError("Subscription usage refresh failed", error);
				if (!options.silent) {
					vscode.window.showErrorMessage(`Failed to refresh ZenMux subscription usage: ${message}`);
				}
			})
			.finally(() => {
				this.refreshPromise = undefined;
				this.render();
			});

		return this.refreshPromise;
	}

	async showMenu(): Promise<void> {
		const hasKey = !!(await getManagementApiKey(this.context.secrets));
		const items: Array<vscode.QuickPickItem & { action: string }> = [];

		if (hasKey) {
			items.push({ label: "$(sync) Refresh Usage", action: "refresh" });
			items.push({ label: "$(key) Update Management API Key", action: "setKey" });
			items.push({ label: "$(trash) Clear Management API Key", action: "clearKey" });
		} else {
			items.push({ label: "$(key) Set Management API Key", action: "setKey" });
		}
		items.push({ label: "$(book) Open Subscription API Docs", action: "openDocs" });

		const picked = await vscode.window.showQuickPick(items, {
			title: "ZenMux Subscription",
			placeHolder: this.getMenuPlaceholder(),
		});
		if (!picked) {
			return;
		}

		if (picked.action === "refresh") {
			await this.refresh({ force: true, silent: false });
		} else if (picked.action === "setKey") {
			await this.setManagementApiKey();
		} else if (picked.action === "clearKey") {
			await this.clearManagementApiKey();
		} else if (picked.action === "openDocs") {
			await vscode.env.openExternal(vscode.Uri.parse(SUBSCRIPTION_DOC_URL));
		}
	}

	private render(): void {
		this.statusBarItem.backgroundColor = undefined;

		if (this.state.type === "not_configured") {
			this.statusBarItem.text = "$(pulse) ZenMux";
			this.statusBarItem.tooltip = "Set Management API Key to view subscription usage.";
			return;
		}

		if (this.state.type === "loading") {
			this.statusBarItem.text = "$(loading~spin) ZenMux";
			this.statusBarItem.tooltip = "Refreshing ZenMux subscription usage...";
			return;
		}

		const ready = this.state.type === "ready" ? this.state : this.state.lastReady;
		if (!ready) {
			this.statusBarItem.text = "$(warning) ZenMux";
			this.statusBarItem.tooltip = `ZenMux usage unavailable.\n${this.state.type === "error" ? this.state.message : ""}`;
			this.statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
			return;
		}

		const fiveHour = ready.detail.quota_5_hour;
		const sevenDay = ready.detail.quota_7_day;
		const fiveHourPercent = this.formatPercent(fiveHour.usage_percentage);
		const sevenDayPercent = this.formatPercent(sevenDay.usage_percentage);
		const highestUsage = Math.max(fiveHour.usage_percentage, sevenDay.usage_percentage);

		this.statusBarItem.text = `${highestUsage >= 0.95 ? "$(warning)" : "$(pulse)"} ZenMux ${fiveHourPercent} · 7d ${sevenDayPercent}`;
		this.statusBarItem.tooltip = this.createTooltip(ready.detail, ready.updatedAt, this.state.type === "error" ? this.state.message : undefined);

		if (highestUsage >= 0.95) {
			this.statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
		} else if (highestUsage >= 0.8 || this.state.type === "error") {
			this.statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
		}
	}

	private createTooltip(detail: SubscriptionDetail, updatedAt: number, error?: string): string {
		const lines = [
			`Plan: ${detail.plan.tier}`,
			`Status: ${detail.account_status}`,
			"",
			"5-hour quota",
			this.formatQuota(detail.quota_5_hour),
			"",
			"7-day quota",
			this.formatQuota(detail.quota_7_day),
			"",
			`Updated: ${this.formatDate(updatedAt)}`,
			"Click for actions.",
		];

		if (error) {
			lines.splice(lines.length - 1, 0, "", `Last refresh failed: ${error}`);
		}

		return lines.join("\n");
	}

	private formatQuota(quota: SubscriptionQuota): string {
		return [
			`${this.formatFlow(quota.used_flows)} / ${this.formatFlow(quota.max_flows)} Flow used (${this.formatPercent(quota.usage_percentage)})`,
			`${this.formatFlow(quota.remaining_flows)} Flow remaining`,
			`Resets: ${quota.resets_at ? this.formatDate(Date.parse(quota.resets_at)) : "not started"}`,
		].join("\n");
	}

	private getMenuPlaceholder(): string {
		if (this.state.type === "ready") {
			return `5-hour ${this.formatPercent(this.state.detail.quota_5_hour.usage_percentage)}, 7-day ${this.formatPercent(this.state.detail.quota_7_day.usage_percentage)}`;
		}
		if (this.state.type === "error") {
			return this.state.message;
		}
		return "Manage ZenMux subscription usage";
	}

	private getLastReadyState(): { detail: SubscriptionDetail; updatedAt: number } | undefined {
		if (this.state.type === "ready") {
			return { detail: this.state.detail, updatedAt: this.state.updatedAt };
		}
		if (this.state.type === "error") {
			return this.state.lastReady;
		}
		return undefined;
	}

	private formatPercent(value: number): string {
		return `${Math.round(value * 100)}%`;
	}

	private formatFlow(value: number): string {
		return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
	}

	private formatDate(value: number): string {
		return new Date(value).toLocaleString();
	}

	private getErrorMessage(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}

	private logError(prefix: string, error: unknown): void {
		const message = this.getErrorMessage(error);
		try {
			this.output.appendLine(`[ZenMux Subscription] ${prefix}: ${message}`);
		} catch {
			console.error(`[ZenMux Subscription] ${prefix}: ${message}`);
		}
	}
}
