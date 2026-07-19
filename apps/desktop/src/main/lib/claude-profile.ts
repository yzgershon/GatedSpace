/**
 * Claude account profiles.
 *
 * Multiple Claude accounts can share one machine, each with its own config
 * dir (what the Claude CLI reads via CLAUDE_CONFIG_DIR). Profiles are
 * declared in ~/.superset/claude-profile.json:
 *
 *   {
 *     "mode": "auto" | "<profileId>",
 *     "profiles": {
 *       "<profileId>": {
 *         "label": "Work",              // optional; defaults to the id
 *         "email": "me@example.com",    // optional, display only
 *         "configDir": ".claude-work"   // home-relative folder or absolute path
 *       }
 *     }
 *   }
 *
 * "auto" resolves to the first declared profile that is signed in and not
 * rate-limited, in declaration order. With no file (fresh install) a single
 * default profile pointing at ~/.claude is assumed and the switcher UI stays
 * hidden. New agents pick up the active profile at launch; running agents
 * keep whichever account they started with.
 */
import {
	existsSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export interface ClaudeAccountProfile {
	id: string;
	label: string;
	email?: string;
	/** Absolute path to the profile's Claude config dir. */
	configDir: string;
	/** Whether this profile has completed its one-time CLI login. */
	ready: boolean;
}

export interface ClaudeProfileState {
	/** "auto" or a profile id. */
	mode: string;
	/** Which profile a NEW agent would use right now (auto resolved). */
	activeProfileId: string;
	profiles: ClaudeAccountProfile[];
}

const PROFILE_FILE = () => join(homedir(), ".superset", "claude-profile.json");

function readJson(path: string): any | null {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}

function hasCreds(dir: string): boolean {
	return existsSync(join(dir, ".credentials.json"));
}

function exhausted(dir: string): boolean {
	const rl = readJson(join(dir, "cache", "rate-limits.json"));
	if (!rl) return false;
	const now = Math.floor(Date.now() / 1000);
	const spent = (w: any, cap: number) =>
		w &&
		w.used_percentage != null &&
		w.used_percentage >= cap &&
		(!w.resets_at || w.resets_at > now);
	return spent(rl.five_hour, 95) || spent(rl.seven_day, 98);
}

function resolveConfigDir(configDir: string): string {
	return isAbsolute(configDir) || /[\\/]/.test(configDir)
		? configDir
		: join(homedir(), configDir);
}

function titleCase(id: string): string {
	return id.charAt(0).toUpperCase() + id.slice(1);
}

/** Profiles in declaration order; a single ~/.claude default when unconfigured. */
export function listClaudeProfiles(): ClaudeAccountProfile[] {
	const state = readJson(PROFILE_FILE()) ?? {};
	const declared =
		state.profiles && typeof state.profiles === "object"
			? Object.entries(state.profiles as Record<string, any>)
			: [];

	const profiles: ClaudeAccountProfile[] = [];
	const seenDirs = new Set<string>();
	for (const [id, entry] of declared) {
		if (!entry || typeof entry.configDir !== "string") continue;
		const configDir = resolveConfigDir(entry.configDir);
		if (seenDirs.has(configDir)) continue;
		seenDirs.add(configDir);
		profiles.push({
			id,
			label: typeof entry.label === "string" ? entry.label : titleCase(id),
			...(typeof entry.email === "string" ? { email: entry.email } : {}),
			configDir,
			ready: hasCreds(configDir),
		});
	}

	if (profiles.length === 0) {
		const configDir = join(homedir(), ".claude");
		profiles.push({
			id: "default",
			label: "Claude",
			configDir,
			ready: hasCreds(configDir),
		});
	}
	return profiles;
}

export function getClaudeProfile(): ClaudeProfileState {
	const profiles = listClaudeProfiles();
	const state = readJson(PROFILE_FILE()) ?? {};
	const mode =
		state.mode === "auto" || profiles.some((p) => p.id === state.mode)
			? (state.mode as string)
			: "auto";

	let activeProfileId = profiles[0]?.id ?? "default";
	if (mode !== "auto") {
		activeProfileId = mode;
	} else {
		const available = profiles.find(
			(p) => p.ready && !exhausted(p.configDir),
		);
		if (available) activeProfileId = available.id;
	}
	return { mode, activeProfileId, profiles };
}

export function setClaudeProfileMode(mode: string): void {
	const valid =
		mode === "auto" || listClaudeProfiles().some((p) => p.id === mode);
	if (!valid) return;
	const path = PROFILE_FILE();
	const state = readJson(path) ?? {};
	state.mode = mode;
	writeFileSync(path, `${JSON.stringify(state, null, "\t")}\n`);
}

/**
 * Claude project-transcript roots across all profiles — session pickers,
 * last-message readers, and usage stats scan every account's store. Deduped
 * by real path so profiles whose stores are junctioned/symlinked together
 * (a common multi-account setup) aren't scanned or counted twice.
 */
export function getClaudeProjectRoots(): string[] {
	const roots: string[] = [];
	const seenReal = new Set<string>();
	const add = (dir: string) => {
		if (!existsSync(dir)) return;
		let real = dir;
		try {
			real = realpathSync(dir);
		} catch {}
		if (seenReal.has(real)) return;
		seenReal.add(real);
		roots.push(dir);
	};
	for (const profile of listClaudeProfiles()) {
		add(join(profile.configDir, "projects"));
	}
	add(join(homedir(), ".claude", "projects"));
	return roots;
}
