import { latestQuotaReset, resetEpochMs } from "../usage-recovery";
import { record, text } from "./types";

export function codexQuotaReset(
	value: unknown,
	model?: string,
	now = Date.now(),
): number | null {
	const response = record(value);
	const buckets = record(response.rateLimitsByLimitId);
	const matching = model
		? Object.values(buckets).find((b) => record(b).normalModelSlug === model)
		: undefined;
	const limit = record(matching ?? buckets.codex ?? response.rateLimits);
	return latestQuotaReset(
		[limit.primary, limit.secondary].map((raw) => {
			const window = record(raw);
			return {
				used:
					typeof window.usedPercent === "number" ? window.usedPercent : null,
				reset: resetEpochMs(window.resetsAt),
			};
		}),
		now,
	);
}

/** Quota exhaustion is actionable; transient throttling/network errors are not. */
export function isCodexUsageLimit(error: unknown): boolean {
	const value = record(error);
	const info = value.codexErrorInfo;
	if (
		[info, value.code, record(info).type].some(
			(code) =>
				typeof code === "string" &&
				/^(usageLimitExceeded|usage_limit_reached|insufficient_quota)$/.test(
					code,
				),
		)
	)
		return true;
	const message = typeof error === "string" ? error : text(value.message);
	if (
		/(?:hit|reached|exceeded|out of)[\s\S]{0,40}(?:usage limit|quota)|(?:usage limit|quota)[\s\S]{0,30}(?:reached|exceeded|exhausted)|insufficient_quota|usage_limit_reached/i.test(
			message,
		)
	)
		return true;
	return [value.data, value.error].some(
		(child) =>
			child !== undefined && child !== error && isCodexUsageLimit(child),
	);
}
