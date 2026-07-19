/**
 * Unified AI usage stats for the GatedSpace "Usage" page.
 *
 * Aggregates real token usage from the CLI agents the user runs:
 *   - Claude Code transcripts:  ~/.claude/projects/**\/*.jsonl
 *   - Codex sessions:           ~/.codex/sessions|archived_sessions/**\/*.jsonl
 *
 * Token accounting matches Anthropic's dashboard: "in" = uncached input,
 * "out" = output (+ reasoning for Codex). Cache reads are excluded so the
 * numbers reflect tokens actually processed. Results are cached briefly since
 * parsing walks a few hundred files.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getClaudeProjectRoots, listClaudeProfiles } from "./claude-profile";

export interface UsageModel {
	name: string;
	in: number;
	out: number;
	total: number;
}
export interface UsageDay {
	day: string;
	total: number;
	byModel: Record<string, number>;
}
export interface QuotaWindow {
	usedPercent: number;
	windowMinutes: number;
	resetsAt: number; // unix seconds
}
export interface ProviderQuota {
	provider: "Claude" | "Codex";
	/** Account label when one provider has multiple accounts (Claude). */
	account: string | null;
	plan: string | null;
	updatedAt: number | null; // ms epoch of the snapshot this came from
	fiveHour: QuotaWindow | null;
	weekly: QuotaWindow | null;
}
export interface UsageStats {
	sessions: number;
	messages: number;
	totalTokens: number;
	activeDays: number;
	currentStreak: number;
	longestStreak: number;
	peakHour: number;
	favorite: string;
	models: UsageModel[];
	modelOrder: string[];
	perDay: UsageDay[];
	quotas: ProviderQuota[];
	generatedAt: string;
}

/** Classify a Codex rate-limit window by its duration. */
function windowSlot(windowMinutes: number): "fiveHour" | "weekly" {
	return windowMinutes <= 600 ? "fiveHour" : "weekly";
}

/**
 * Claude Code has no quota data in its transcripts, but it pushes real
 * five_hour / seven_day percentages to the user's status line on every
 * render; a statusline script can persist that snapshot per account
 * profile (see main/lib/claude-profile.ts). Read-only.
 */
function readClaudeQuota(
	configDir: string,
	account: string,
): ProviderQuota | null {
	try {
		const raw = readFileSync(
			join(configDir, "cache", "rate-limits.json"),
			"utf8",
		);
		const o = JSON.parse(raw);
		const win = (w: any, minutes: number): QuotaWindow | null =>
			w && w.used_percentage != null
				? {
						usedPercent: Math.round(w.used_percentage),
						windowMinutes: minutes,
						resetsAt: w.resets_at ?? 0,
					}
				: null;
		const fiveHour = win(o.five_hour, 300);
		const weekly = win(o.seven_day, 10080);
		if (!fiveHour && !weekly) return null;
		return {
			provider: "Claude",
			account,
			plan: o.plan ?? null,
			updatedAt: o.updatedAt ?? null,
			fiveHour,
			weekly,
		};
	} catch {
		return null;
	}
}

function walkJsonl(dir: string): string[] {
	const out: string[] = [];
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return out;
	}
	for (const e of entries) {
		const p = join(dir, e);
		let s: ReturnType<typeof statSync>;
		try {
			s = statSync(p);
		} catch {
			continue;
		}
		if (s.isDirectory()) out.push(...walkJsonl(p));
		else if (e.endsWith(".jsonl")) out.push(p);
	}
	return out;
}

function claudeModelName(m: string | undefined): string {
	if (!m) return "";
	if (m.includes("opus-4-8")) return "Opus 4.8";
	if (m.includes("opus-4-7")) return "Opus 4.7";
	if (m.includes("sonnet-4-6")) return "Sonnet 4.6";
	if (m.includes("sonnet-4-5")) return "Sonnet 4.5";
	if (m.includes("fable-5")) return "Fable 5";
	if (m.includes("haiku-4-5")) return "Haiku 4.5";
	if (m.includes("haiku")) return "Haiku";
	if (m.startsWith("<")) return "";
	return m;
}

let cache: { at: number; stats: UsageStats } | null = null;
const CACHE_MS = 60_000;

export function computeUsageStats(now = Date.now(), force = false): UsageStats {
	if (!force && cache && now - cache.at < CACHE_MS) return cache.stats;

	const home = homedir();
	type Tok = { in: number; out: number };
	const perDayModel = new Map<string, Map<string, Tok>>();
	const modelTotals = new Map<string, Tok>();
	const sessions = new Set<string>();
	const activeDays = new Set<string>();
	const hours = new Array(24).fill(0);
	let messages = 0;
	const quotas: ProviderQuota[] = [];

	const add = (day: string, name: string, tin: number, tout: number) => {
		if (!perDayModel.has(day)) perDayModel.set(day, new Map());
		const dm = perDayModel.get(day)!;
		if (!dm.has(name)) dm.set(name, { in: 0, out: 0 });
		dm.get(name)!.in += tin;
		dm.get(name)!.out += tout;
		if (!modelTotals.has(name)) modelTotals.set(name, { in: 0, out: 0 });
		modelTotals.get(name)!.in += tin;
		modelTotals.get(name)!.out += tout;
	};

	// ---- Claude Code ----
	for (const f of getClaudeProjectRoots().flatMap((root) => walkJsonl(root))) {
		let text: string;
		try {
			text = readFileSync(f, "utf8");
		} catch {
			continue;
		}
		for (const line of text.split("\n")) {
			if (!line.trim()) continue;
			let o: any;
			try {
				o = JSON.parse(line);
			} catch {
				continue;
			}
			if ((o.type === "user" || o.type === "assistant") && !o.isSidechain)
				messages++;
			if (o.sessionId) sessions.add(o.sessionId);
			if (o.type !== "assistant" || !o.message?.usage || !o.timestamp) continue;
			const name = claudeModelName(o.message.model);
			if (!name) continue;
			const u = o.message.usage;
			const tin = u.input_tokens || 0;
			const tout = u.output_tokens || 0;
			const d = new Date(o.timestamp);
			hours[d.getHours()] += tout;
			activeDays.add(d.toISOString().slice(0, 10));
			add(d.toISOString().slice(0, 10), name, tin, tout);
		}
	}

	// ---- Codex ----
	let codexQuotaTs = 0;
	for (const base of [
		join(home, ".codex", "sessions"),
		join(home, ".codex", "archived_sessions"),
	]) {
		for (const f of walkJsonl(base)) {
			let text: string;
			try {
				text = readFileSync(f, "utf8");
			} catch {
				continue;
			}
			for (const line of text.split("\n")) {
				if (!line.trim()) continue;
				let o: any;
				try {
					o = JSON.parse(line);
				} catch {
					continue;
				}
				const p = o.payload;
				if (o.type === "session_meta" && p?.session_id)
					sessions.add(p.session_id);
				if (o.type === "response_item" && p?.type === "message") messages++;
				if (o.type === "event_msg" && p?.type === "token_count") {
					const lu = p.info?.last_token_usage;
					if (lu && o.timestamp) {
						const tin = Math.max(
							0,
							(lu.input_tokens || 0) - (lu.cached_input_tokens || 0),
						);
						const tout =
							(lu.output_tokens || 0) + (lu.reasoning_output_tokens || 0);
						if (tin + tout > 0) {
							const d = new Date(o.timestamp);
							hours[d.getHours()] += tout;
							activeDays.add(d.toISOString().slice(0, 10));
							add(d.toISOString().slice(0, 10), "Codex", tin, tout);
						}
					}
					const rl = p.rate_limits;
					if (rl?.primary && o.timestamp) {
						const ts = Date.parse(o.timestamp);
						if (ts > codexQuotaTs) {
							codexQuotaTs = ts;
							const q: ProviderQuota = {
								provider: "Codex",
								account: null,
								plan: rl.plan_type ?? null,
								updatedAt: ts,
								fiveHour: null,
								weekly: null,
							};
							for (const w of [rl.primary, rl.secondary]) {
								if (!w || w.used_percent == null) continue;
								const minutes = w.window_minutes ?? 10080;
								q[windowSlot(minutes)] = {
									usedPercent: Math.round(w.used_percent),
									windowMinutes: minutes,
									resetsAt: w.resets_at ?? 0,
								};
							}
							// replace any prior codex quota
							const idx = quotas.findIndex((v) => v.provider === "Codex");
							if (idx >= 0) quotas[idx] = q;
							else quotas.push(q);
						}
					}
				}
			}
		}
	}

	for (const profile of [...listClaudeProfiles()].reverse()) {
		const quota = readClaudeQuota(profile.configDir, profile.label);
		if (quota) quotas.unshift(quota);
	}

	const days = [...activeDays].sort();
	const totalTokens = [...modelTotals.values()].reduce(
		(a, t) => a + t.in + t.out,
		0,
	);
	const models: UsageModel[] = [...modelTotals.entries()]
		.map(([name, t]) => ({ name, in: t.in, out: t.out, total: t.in + t.out }))
		.sort((a, b) => b.total - a.total);
	const favorite = models[0]?.name ?? "-";
	const peakHour = hours.indexOf(Math.max(...hours));
	let longest = 0,
		cur = 0,
		prev: number | null = null;
	for (const d of days) {
		const t = Math.round(Date.parse(d) / 86400000);
		cur = prev !== null && t - prev === 1 ? cur + 1 : 1;
		prev = t;
		longest = Math.max(longest, cur);
	}
	const todayNum = Math.floor(now / 86400000);
	const daySet = new Set(days.map((d) => Math.round(Date.parse(d) / 86400000)));
	let currentStreak = 0;
	let s = daySet.has(todayNum)
		? todayNum
		: daySet.has(todayNum - 1)
			? todayNum - 1
			: null;
	if (s !== null) {
		let t = s;
		while (daySet.has(t)) {
			currentStreak++;
			t--;
		}
	}

	const stats: UsageStats = {
		sessions: sessions.size,
		messages,
		totalTokens,
		activeDays: activeDays.size,
		currentStreak,
		longestStreak: longest,
		peakHour,
		favorite,
		models,
		modelOrder: models.map((m) => m.name),
		perDay: [...perDayModel.entries()].sort().map(([day, dm]) => ({
			day,
			total: [...dm.values()].reduce((a, t) => a + t.in + t.out, 0),
			byModel: Object.fromEntries(
				[...dm.entries()].map(([m, t]) => [m, t.in + t.out]),
			),
		})),
		quotas,
		generatedAt: new Date(now).toISOString(),
	};
	cache = { at: now, stats };
	return stats;
}
