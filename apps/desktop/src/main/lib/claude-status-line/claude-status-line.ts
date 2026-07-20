/**
 * Install / remove GatedSpace's Claude Code status line.
 *
 * Claude Code shows a status line under its prompt when `statusLine` is set in
 * its settings.json. GatedSpace ships a script for that slot (see script.ts):
 * model, account, branch, 5h + weekly limits, context fill, session cost.
 *
 * Beyond the display, the script writes each reply's rate-limit payload to
 * `<configDir>/cache/rate-limits.json`, which is the only local source of real
 * subscription limits — the Usage popup and account auto-failover read it and
 * make no network calls. So installing the status line is also what turns on
 * real usage numbers.
 *
 * Safety rules, in order of importance:
 *  1. Never overwrite a status line the user already configured. A custom
 *     entry is reported back so the UI can offer an explicit replace.
 *  2. Never rewrite unrelated settings. settings.json is read, one key is
 *     changed, and it is written back.
 *  3. Every profile (Claude account) gets wired, since each account has its
 *     own config dir and its own settings.json.
 */
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { listClaudeProfiles } from "../claude-profile";
import { STATUS_LINE_MARKER, STATUS_LINE_SCRIPT } from "./script";

/** Shared by every profile; the script itself is account-aware via CLAUDE_CONFIG_DIR. */
export function statusLineScriptPath(): string {
	return join(homedir(), ".superset", "claude-status-line.js");
}

export interface StatusLineProfileState {
	id: string;
	label: string;
	configDir: string;
	/** GatedSpace's status line is wired up for this account. */
	wired: boolean;
	/** A different status line command is configured here, if any. */
	customCommand: string | null;
}

export interface StatusLineState {
	scriptPath: string;
	/** True when every profile is wired to our script. */
	installed: boolean;
	/** True when at least one profile has someone else's status line. */
	hasCustom: boolean;
	profiles: StatusLineProfileState[];
}

type JsonRecord = Record<string, unknown>;

function readSettings(configDir: string): JsonRecord {
	try {
		const parsed: unknown = JSON.parse(
			readFileSync(join(configDir, "settings.json"), "utf8"),
		);
		return typeof parsed === "object" && parsed !== null
			? (parsed as JsonRecord)
			: {};
	} catch {
		return {};
	}
}

function writeSettings(configDir: string, settings: JsonRecord): void {
	mkdirSync(configDir, { recursive: true });
	writeFileSync(
		join(configDir, "settings.json"),
		`${JSON.stringify(settings, null, 2)}\n`,
		"utf8",
	);
}

function statusLineCommand(settings: JsonRecord): string | null {
	const entry = settings.statusLine;
	if (!entry || typeof entry !== "object") return null;
	const command = (entry as { command?: unknown }).command;
	return typeof command === "string" ? command : null;
}

/** Our command references the script path we own — that is how we recognise it. */
function isOurs(command: string | null, scriptPath: string): boolean {
	if (!command) return false;
	return command.replace(/\\/g, "/").includes(scriptPath.replace(/\\/g, "/"));
}

/** Injection seam for tests; production reads the real profiles and home. */
export interface StatusLineTargets {
	profiles?: { id: string; label: string; configDir: string }[];
	scriptPath?: string;
}

export function getStatusLineState(
	targets: StatusLineTargets = {},
): StatusLineState {
	const scriptPath = targets.scriptPath ?? statusLineScriptPath();
	const scriptPresent = existsSync(scriptPath);

	const profiles = (targets.profiles ?? listClaudeProfiles()).map((profile) => {
		const command = statusLineCommand(readSettings(profile.configDir));
		const ours = isOurs(command, scriptPath);
		return {
			id: profile.id,
			label: profile.label,
			configDir: profile.configDir,
			wired: ours && scriptPresent,
			customCommand: command && !ours ? command : null,
		};
	});

	return {
		scriptPath,
		installed: profiles.length > 0 && profiles.every((p) => p.wired),
		hasCustom: profiles.some((p) => p.customCommand !== null),
		profiles,
	};
}

export interface InstallStatusLineOptions {
	/** Replace a status line the user configured themselves. Off by default. */
	replaceCustom?: boolean;
}

/**
 * Write the script and point every Claude account's settings.json at it.
 * Accounts with a custom status line are left alone unless replaceCustom.
 */
export function installStatusLine(
	options: InstallStatusLineOptions & StatusLineTargets = {},
): StatusLineState {
	const scriptPath = options.scriptPath ?? statusLineScriptPath();
	mkdirSync(dirname(scriptPath), { recursive: true });
	// Rewritten every install so an upgraded app ships its newer script.
	writeFileSync(scriptPath, STATUS_LINE_SCRIPT, "utf8");

	for (const profile of options.profiles ?? listClaudeProfiles()) {
		const settings = readSettings(profile.configDir);
		const command = statusLineCommand(settings);
		if (command && !isOurs(command, scriptPath) && !options.replaceCustom) {
			continue;
		}
		// `node` rather than an absolute interpreter path: Claude Code runs the
		// command through the user's shell, and Node is already a hard
		// requirement for the CLI itself.
		settings.statusLine = {
			type: "command",
			command: `node "${scriptPath}"`,
		};
		writeSettings(profile.configDir, settings);
	}

	return getStatusLineState(options);
}

/** Remove our statusLine entry from every account. Custom ones stay untouched. */
export function uninstallStatusLine(
	targets: StatusLineTargets = {},
): StatusLineState {
	const scriptPath = targets.scriptPath ?? statusLineScriptPath();
	for (const profile of targets.profiles ?? listClaudeProfiles()) {
		const settings = readSettings(profile.configDir);
		if (!isOurs(statusLineCommand(settings), scriptPath)) continue;
		delete settings.statusLine;
		writeSettings(profile.configDir, settings);
	}
	rmSync(scriptPath, { force: true });
	return getStatusLineState(targets);
}

export { STATUS_LINE_MARKER };
