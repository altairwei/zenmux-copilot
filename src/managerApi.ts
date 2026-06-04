export interface SubscriptionPlan {
	tier: string;
	amount_usd: number;
	interval: string;
	expires_at: string;
}

export interface SubscriptionQuota {
	usage_percentage: number;
	resets_at: string | null;
	max_flows: number;
	used_flows: number;
	remaining_flows: number;
	used_value_usd: number;
	max_value_usd: number;
}

export interface MonthlySubscriptionQuota {
	max_flows: number;
	max_value_usd: number;
}

export interface SubscriptionDetail {
	plan: SubscriptionPlan;
	currency: string;
	base_usd_per_flow: number;
	effective_usd_per_flow: number;
	account_status: string;
	quota_5_hour: SubscriptionQuota;
	quota_7_day: SubscriptionQuota;
	quota_monthly: MonthlySubscriptionQuota;
}

interface SubscriptionDetailResponse {
	success: boolean;
	data?: SubscriptionDetail;
	error?: {
		code?: string;
		type?: string;
		message?: string;
	};
}

const SUBSCRIPTION_DETAIL_URL = "https://zenmux.ai/api/v1/management/subscription/detail";

export async function fetchSubscriptionDetail(
	managementApiKey: string,
	userAgent: string
): Promise<SubscriptionDetail> {
	const response = await fetch(SUBSCRIPTION_DETAIL_URL, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${managementApiKey}`,
			"User-Agent": userAgent,
		},
	});

	const text = await response.text();
	let parsed: SubscriptionDetailResponse | undefined;
	try {
		parsed = text ? JSON.parse(text) as SubscriptionDetailResponse : undefined;
	} catch {
		parsed = undefined;
	}

	if (!response.ok) {
		const message = parsed?.error?.message || text || response.statusText;
		throw new Error(`[${response.status}] ${message}`);
	}

	if (!parsed?.success || !parsed.data) {
		throw new Error(parsed?.error?.message || "Invalid subscription detail response");
	}

	return parsed.data;
}
