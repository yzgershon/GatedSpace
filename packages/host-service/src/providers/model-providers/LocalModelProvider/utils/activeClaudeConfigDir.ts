import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface ClaudeProfileFile {
	mode?: string;
	profiles?: Record<string, { configDir?: string }>;
}

function resolveProfileDir(
	home: string,
	configDir: string | undefined,
): string | null {
	if (!configDir) return null;
	// A configDir may be absolute (contains a path separator) or a home-relative
	// folder name like ".claude-work".
	return /[\\/]/.test(configDir) ? configDir : join(home, configDir);
}

function readProfileFile(home: string): ClaudeProfileFile | null {
	try {
		const profilePath = join(home, ".superset", "claude-profile.json");
		if (!existsSync(profilePath)) return null;
		return JSON.parse(readFileSync(profilePath, "utf-8")) as ClaudeProfileFile;
	} catch {
		return null;
	}
}

function hasCreds(dir: string): boolean {
	return existsSync(join(dir, ".credentials.json"));
}

/**
 * Whether an account has burned through its rate limits (per the local
 * snapshot a Claude statusline script writes). Used so "auto" profile
 * resolution fails over to the next signed-in account. Mirrors the rules in
 * apps/desktop main/lib/claude-profile.ts.
 */
function isExhausted(dir: string): boolean {
	try {
		const rl = JSON.parse(
			readFileSync(join(dir, "cache", "rate-limits.json"), "utf-8"),
		);
		const now = Math.floor(Date.now() / 1000);
		const spent = (raw: unknown, cap: number): boolean => {
			if (!raw || typeof raw !== "object") return false;
			const w = raw as {
				used_percentage?: number | null;
				resets_at?: number | null;
			};
			return (
				w.used_percentage != null &&
				w.used_percentage >= cap &&
				(!w.resets_at || w.resets_at > now)
			);
		};
		return spent(rl.five_hour, 95) || spent(rl.seven_day, 98);
	} catch {
		return false;
	}
}

/**
 * Claude config directories to search for credentials, in priority order.
 *
 * Multiple Claude account profiles can share one machine (see apps/desktop
 * claude-profile.ts): the active account is recorded in
 * ~/.superset/claude-profile.json and each account has its own config dir.
 * CLI agents are launched with the right CLAUDE_CONFIG_DIR, but the
 * in-process chat runtime does not inherit it — so without consulting the
 * profile here the chat would always read ~/.claude even when another
 * account is active (and its token may be expired), producing a false
 * "No model provider credentials available".
 */
export function getClaudeConfigDirCandidates(): string[] {
	const home = homedir();
	const dirs: string[] = [];
	const add = (dir: string | null | undefined) => {
		const trimmed = dir?.trim();
		if (trimmed && !dirs.includes(trimmed)) dirs.push(trimmed);
	};

	// 1. Explicit override (shell-launched agents / power users).
	add(process.env.CLAUDE_CONFIG_DIR);

	// 2. Accounts declared in the profile file, active one first.
	const profile = readProfileFile(home);
	if (profile) {
		const profiles = profile.profiles ?? {};
		const activeMode =
			profile.mode && profile.mode !== "auto" ? profile.mode : undefined;
		if (activeMode && profiles[activeMode]) {
			add(resolveProfileDir(home, profiles[activeMode]?.configDir));
		}
		for (const entry of Object.values(profiles)) {
			add(resolveProfileDir(home, entry.configDir));
		}
	}

	// 3. Defaults.
	add(join(home, ".claude"));
	add(join(home, ".config", "claude"));
	return dirs;
}

/**
 * The active Claude config dir to run with — the first candidate that holds
 * credentials and isn't rate-limited (so "auto" fails over), falling back to
 * the first with credentials, then the first candidate.
 */
export function getActiveClaudeConfigDir(): string | null {
	const candidates = getClaudeConfigDirCandidates();
	const withCreds = candidates.filter((dir) => hasCreds(dir));
	const available = withCreds.find((dir) => !isExhausted(dir));
	return available ?? withCreds[0] ?? candidates[0] ?? null;
}

/**
 * Env overlay for launching a Claude CLI agent under the active account
 * profile. Empty unless the machine declares more than one profile — single
 * account setups keep the CLI's own default resolution (and any user-level
 * CLAUDE_CONFIG_DIR) untouched.
 */
export function getClaudeLaunchEnv(): Record<string, string> {
	const profile = readProfileFile(homedir());
	const declared = Object.keys(profile?.profiles ?? {});
	if (declared.length < 2) return {};
	const dir = getActiveClaudeConfigDir();
	return dir ? { CLAUDE_CONFIG_DIR: dir } : {};
}
