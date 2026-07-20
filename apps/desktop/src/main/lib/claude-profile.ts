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
	mkdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

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

type JsonRecord = Record<string, unknown>;

function readJson(path: string): JsonRecord | null {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		return typeof parsed === "object" && parsed !== null
			? (parsed as JsonRecord)
			: null;
	} catch {
		return null;
	}
}

function hasCreds(dir: string): boolean {
	return existsSync(join(dir, ".credentials.json"));
}

interface RateLimitWindow {
	used_percentage?: number | null;
	resets_at?: number | null;
}

function exhausted(dir: string): boolean {
	const rl = readJson(join(dir, "cache", "rate-limits.json"));
	if (!rl) return false;
	const now = Math.floor(Date.now() / 1000);
	const spent = (raw: unknown, cap: number): boolean => {
		if (!raw || typeof raw !== "object") return false;
		const w = raw as RateLimitWindow;
		return (
			w.used_percentage != null &&
			w.used_percentage >= cap &&
			(!w.resets_at || w.resets_at > now)
		);
	};
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
			? Object.entries(state.profiles as Record<string, unknown>)
			: [];

	const profiles: ClaudeAccountProfile[] = [];
	const seenDirs = new Set<string>();
	for (const [id, rawEntry] of declared) {
		if (!rawEntry || typeof rawEntry !== "object") continue;
		const entry = rawEntry as {
			configDir?: unknown;
			label?: unknown;
			email?: unknown;
		};
		if (typeof entry.configDir !== "string") continue;
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
		const available = profiles.find((p) => p.ready && !exhausted(p.configDir));
		if (available) activeProfileId = available.id;
	}
	return { mode, activeProfileId, profiles };
}

function writeProfileState(state: JsonRecord): void {
	const path = PROFILE_FILE();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(state, null, "\t")}\n`);
}

export function setClaudeProfileMode(mode: string): void {
	const valid =
		mode === "auto" || listClaudeProfiles().some((p) => p.id === mode);
	if (!valid) return;
	const state = readJson(PROFILE_FILE()) ?? {};
	state.mode = mode;
	writeProfileState(state);
}

/** `Work Account` → `work-account`; ids are used as config-dir suffixes. */
function slugify(label: string): string {
	return (
		label
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 32) || "account"
	);
}

/**
 * Declare a new Claude account. Only the config dir is created — signing in is
 * the Claude CLI's job, and happens the first time an agent launches under the
 * new profile (no credentials there yet, so the CLI runs its login flow).
 *
 * The first added account also materialises an explicit entry for the existing
 * default account, so the file describes every account rather than leaving the
 * original implicit.
 */
export function addClaudeProfile(label: string): ClaudeAccountProfile {
	const trimmed = label.trim();
	if (!trimmed) throw new Error("Account name is required.");

	const state = readJson(PROFILE_FILE()) ?? {};
	const profiles: JsonRecord =
		state.profiles && typeof state.profiles === "object"
			? (state.profiles as JsonRecord)
			: {};

	if (Object.keys(profiles).length === 0) {
		profiles.default = { label: "Default", configDir: ".claude" };
	}

	const base = slugify(trimmed);
	let id = base;
	for (let i = 2; profiles[id] !== undefined; i++) id = `${base}-${i}`;

	const configDir = join(homedir(), `.claude-${id}`);
	if (existsSync(configDir) && hasCreds(configDir)) {
		// Reusing a dir that is already signed in is fine — adopt it as-is.
	} else {
		mkdirSync(configDir, { recursive: true });
	}

	profiles[id] = { label: trimmed, configDir };
	state.profiles = profiles;
	writeProfileState(state);

	return { id, label: trimmed, configDir, ready: hasCreds(configDir) };
}

/**
 * Forget an account. The config dir (and its credentials) stay on disk so the
 * account can be re-added without signing in again — and so a mis-click can
 * never destroy a login.
 */
export function removeClaudeProfile(id: string): void {
	const state = readJson(PROFILE_FILE()) ?? {};
	const profiles =
		state.profiles && typeof state.profiles === "object"
			? (state.profiles as JsonRecord)
			: {};
	if (profiles[id] === undefined) return;
	delete profiles[id];
	state.profiles = profiles;
	if (state.mode === id) state.mode = "auto";
	writeProfileState(state);
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
