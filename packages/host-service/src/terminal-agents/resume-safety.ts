import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { TerminalAgentStore } from "./store";
import type { TerminalAgentBinding, TerminalAgentId } from "./types";

/**
 * Safety checks that gate every agent resume — the picker's resume procedure
 * and the lost-pty auto-resume path both run these before composing a
 * `--resume` command.
 *
 * Why they exist (incidents of 2026-07-18 and 07-19): Claude Code assumes a
 * single writer per session transcript. Resuming a session id that is already
 * live in another terminal creates a second writer, and the newer process's
 * conversation silently never persists — when that process later dies, the
 * conversation is unrecoverable. Separately, auto-resume used to trust the
 * persisted binding's session id blindly; when that id's transcript was never
 * written, the respawned pane dead-ended on "No conversation found".
 */

/**
 * A session id is "live" when any active terminal currently hosts it. The
 * store's list() is liveness-joined (terminal_sessions.status = 'active'),
 * so dead terminals can't produce false positives.
 */
export function findLiveAgentSessionBinding(
	store: TerminalAgentStore,
	agentId: TerminalAgentId,
	agentSessionId: string,
	excludeTerminalId?: string,
): TerminalAgentBinding | undefined {
	for (const binding of store.list()) {
		if (binding.agentId !== agentId) continue;
		if (binding.agentSessionId !== agentSessionId) continue;
		if (excludeTerminalId && binding.terminalId === excludeTerminalId) continue;
		return binding;
	}
	return undefined;
}

/** Overridable roots so tests can point the locator at fixture dirs. */
export interface TranscriptLocatorRoots {
	home?: string;
}

/**
 * Every Claude config dir on this machine: the default `~/.claude` plus any
 * account profiles registered in `~/.superset/claude-profile.json` (the
 * account switcher's state file). Profile `configDir` values are stored
 * relative to the home dir; absolute paths are honored as-is.
 */
function claudeConfigDirs(home: string): string[] {
	const dirs = new Set<string>([join(home, ".claude")]);
	try {
		const raw = JSON.parse(
			readFileSync(join(home, ".superset", "claude-profile.json"), "utf8"),
		) as { profiles?: Record<string, { configDir?: string }> };
		for (const profile of Object.values(raw.profiles ?? {})) {
			const configDir = profile?.configDir;
			if (typeof configDir !== "string" || configDir.length === 0) continue;
			dirs.add(isAbsolute(configDir) ? configDir : join(home, configDir));
		}
	} catch {
		// no profile file (single-account setup) → default dir only
	}
	return [...dirs];
}

function claudeTranscriptExists(sessionId: string, home: string): boolean {
	for (const configDir of claudeConfigDirs(home)) {
		const projectsDir = join(configDir, "projects");
		let slugs: string[];
		try {
			slugs = readdirSync(projectsDir);
		} catch {
			continue;
		}
		for (const slug of slugs) {
			if (existsSync(join(projectsDir, slug, `${sessionId}.jsonl`)))
				return true;
		}
	}
	return false;
}

/**
 * Codex rollouts live at `~/.codex/{sessions,archived_sessions}/YYYY/MM/DD/
 * rollout-<timestamp>-<sessionId>.jsonl`. Walk the date tree and match on the
 * filename suffix.
 */
function codexTranscriptExists(sessionId: string, home: string): boolean {
	const suffix = `${sessionId}.jsonl`;
	for (const rootName of ["sessions", "archived_sessions"]) {
		const root = join(home, ".codex", rootName);
		let years: string[];
		try {
			years = readdirSync(root);
		} catch {
			continue;
		}
		for (const year of years) {
			if (!/^\d{4}$/.test(year)) continue;
			let months: string[];
			try {
				months = readdirSync(join(root, year));
			} catch {
				continue;
			}
			for (const month of months) {
				let days: string[];
				try {
					days = readdirSync(join(root, year, month));
				} catch {
					continue;
				}
				for (const day of days) {
					let files: string[];
					try {
						files = readdirSync(join(root, year, month, day));
					} catch {
						continue;
					}
					if (files.some((file) => file.endsWith(suffix))) return true;
				}
			}
		}
	}
	return false;
}

/**
 * Whether the agent's on-disk transcript for this session actually exists.
 * Unknown agent ids return true — the check must never block agents whose
 * storage layout we don't know.
 */
export function agentTranscriptExists(
	agentId: string,
	agentSessionId: string,
	roots: TranscriptLocatorRoots = {},
): boolean {
	const home = roots.home ?? homedir();
	if (agentId === "claude") return claudeTranscriptExists(agentSessionId, home);
	if (agentId === "codex") return codexTranscriptExists(agentSessionId, home);
	return true;
}
