import { resetEpochMs } from "../usage-recovery";
import type { ClaudeStreamEvent } from "./events";
import { parseResetLabel } from "./usage-report";

export function claudeResetLabel(label: string, now: number): number | null {
	const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const dated = resetEpochMs(parseResetLabel(label, now, zone));
	if (dated !== null) return dated;
	const time = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(([^)]+)\)\s*$/i.exec(
		label.trim(),
	);
	if (
		!time ||
		time[4] !== zone ||
		Number(time[1]) < 1 ||
		Number(time[1]) > 12 ||
		Number(time[2] ?? 0) > 59
	)
		return null;
	const date = new Date(now);
	date.setHours(
		(Number(time[1]) % 12) + (time[3]?.toLowerCase() === "pm" ? 12 : 0),
		Number(time[2] ?? 0),
		0,
		0,
	);
	if (date.getTime() < now) date.setDate(date.getDate() + 1);
	return date.getTime();
}

/** Only provider errors, never quoted user/tool text or an allowed-warning event. */
export function claudeUsageLimit(
	event: ClaudeStreamEvent,
	now = Date.now(),
): { message: string; resetAt: number | null } | null {
	if ("parent_tool_use_id" in event && event.parent_tool_use_id) return null;
	if (event.type === "rate_limit_event") {
		const info = event.rate_limit_info;
		if (info.status !== "rejected" || info.isUsingOverage) return null;
		return {
			message: "Claude's account usage limit was reached.",
			resetAt: resetEpochMs(info.resetsAt),
		};
	}
	let message = "";
	let quotaError = false;
	if (event.type === "assistant") {
		quotaError = event.error === "rate_limit";
		if (!quotaError) return null;
		message = event.message.content
			.filter((b) => b.type === "text")
			.map((b) => b.text)
			.join("\n");
	} else if (event.type === "result" && event.is_error) {
		message = [
			event.result,
			...(Array.isArray(event.errors) ? event.errors : []),
		]
			.filter((s) => typeof s === "string")
			.join("\n");
	} else return null;
	if (
		!quotaError &&
		!/(?:you(?:'|’)ve|you have) (?:hit|reached) (?:your |the )?(?:[\w -]+ )?limit|usage limit|usage_limit_reached|insufficient_quota/i.test(
			message,
		)
	)
		return null;
	const label = /\bresets?\s+([^\n]+)/i.exec(message)?.[1];
	return {
		message: message || "Claude's account usage limit was reached.",
		resetAt: label ? claudeResetLabel(label, now) : null,
	};
}
