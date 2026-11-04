import { existsSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
	type ClaudeCompactionPreference,
	type ClaudeCompactionState,
	claudeCompactionPreference,
} from "shared/claude-compaction";
import { ensureSecureDir, writeSecureFile } from "../secure-file";

type Settings = Record<string, unknown>;
const preferencePath = () =>
	join(homedir(), ".superset", "claude-compaction.json");
function object(value: unknown): value is Settings {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function read(path: string): Settings {
	if (!existsSync(path)) return {};
	try {
		const value: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (object(value)) return value;
	} catch {}
	throw new Error(
		`Cannot read ${path}. Fix its JSON before changing compaction settings.`,
	);
}

/** Explicit empty/false values also clear overrides in already-running CLIs. */
export function applyCompaction(
	settings: Settings,
	preference: ClaudeCompactionPreference,
): Settings {
	const next = { ...settings };
	const env = object(settings.env) ? { ...settings.env } : {};
	if (settings.env !== undefined && !object(settings.env))
		throw new Error("Claude settings.env must be a JSON object.");
	next.autoCompactEnabled = preference.mode !== "off";
	env.DISABLE_AUTO_COMPACT = preference.mode === "off" ? "1" : "0";
	// Keep manual /compact available even with automatic compaction off.
	env.DISABLE_COMPACT = "0";
	env.CLAUDE_CODE_AUTO_COMPACT_WINDOW =
		preference.mode === "custom" ? String(preference.windowTokens) : "";
	// Remove an old early-compaction percentage when choosing a new window.
	env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = "100";
	next.env = env;
	delete next.autoCompactWindow;
	if (object(next.modelSettings)) {
		next.modelSettings = Object.fromEntries(
			Object.entries(next.modelSettings).map(([model, value]) => {
				if (!object(value)) return [model, value];
				const copy = { ...value };
				delete copy.autoCompactWindow;
				return [model, copy];
			}),
		);
	}
	return next;
}

export function inspectCompaction(
	settings: Settings,
): ClaudeCompactionPreference | null {
	const env = object(settings.env) ? settings.env : {};
	const enabled = (value: unknown) => value === "1" || value === "true";
	if (
		enabled(env.DISABLE_COMPACT) ||
		enabled(env.DISABLE_AUTO_COMPACT) ||
		settings.autoCompactEnabled === false
	)
		return { mode: "off" };
	if (
		env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE &&
		Number(env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE) < 100
	)
		return null;
	const environmentWindow = env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
	if (
		!environmentWindow &&
		object(settings.modelSettings) &&
		Object.values(settings.modelSettings).some(
			(model) => object(model) && model.autoCompactWindow !== undefined,
		)
	)
		return null;
	const value = environmentWindow || settings.autoCompactWindow;
	if (value) {
		const parsed = claudeCompactionPreference.safeParse({
			mode: "custom",
			windowTokens: Number(value),
		});
		return parsed.success ? parsed.data : null;
	}
	return { mode: "default" };
}

/** Atomic replacement: never expose a half-written settings file to the CLI watcher. */
export function writeCompactionFile(path: string, contents: string): void {
	ensureSecureDir(dirname(path));
	const temp = `${path}.${process.pid}.tmp`;
	try {
		writeSecureFile(temp, contents);
		renameSync(temp, path);
	} finally {
		if (existsSync(temp)) unlinkSync(temp);
	}
}

export class ClaudeCompactionSettings {
	constructor(
		private readonly accounts: () => { label: string; configDir: string }[],
		private readonly savedPath = preferencePath(),
		private readonly write = writeCompactionFile,
	) {}
	get(): ClaudeCompactionState {
		const accounts = this.targets().map(({ label, configDir }) => ({
			label,
			preference: inspectCompaction(read(join(configDir, "settings.json"))),
		}));
		const first = accounts[0]?.preference ?? null;
		return {
			accounts,
			savedPreference: existsSync(this.savedPath)
				? claudeCompactionPreference.parse(read(this.savedPath))
				: null,
			preference: accounts.every(
				(account) =>
					JSON.stringify(account.preference) === JSON.stringify(first),
			)
				? first
				: null,
		};
	}
	private targets() {
		return [
			...new Map(
				this.accounts().map((account) => [
					process.platform === "win32"
						? resolve(account.configDir).toLowerCase()
						: resolve(account.configDir),
					account,
				]),
			).values(),
		];
	}
	set(input: ClaudeCompactionPreference): ClaudeCompactionState {
		const preference = claudeCompactionPreference.parse(input);
		// Validate every file before changing any account. Backups can contain env secrets.
		const files = this.targets().map(({ configDir }) => {
			const path = join(configDir, "settings.json");
			const settings = read(path);
			return {
				path,
				next: JSON.stringify(applyCompaction(settings, preference), null, 2),
			};
		});
		files.push({
			path: this.savedPath,
			next: JSON.stringify(preference, null, 2),
		});
		const changes = files.map((file) => ({
			...file,
			previous: existsSync(file.path) ? readFileSync(file.path, "utf8") : null,
		}));
		for (const file of changes) {
			if (file.previous !== null)
				this.write(`${file.path}.gatedspace-compaction.bak`, file.previous);
		}
		const written: typeof changes = [];
		try {
			for (const file of changes) {
				this.write(file.path, file.next);
				written.push(file);
			}
		} catch (error) {
			const failed: string[] = [];
			for (const file of written.reverse()) {
				try {
					if (file.previous === null) unlinkSync(file.path);
					else this.write(file.path, file.previous);
				} catch {
					failed.push(file.path);
				}
			}
			throw new Error(
				`Couldn't save Claude compaction settings. ${failed.length ? `Restore these files from their .gatedspace-compaction.bak backups: ${failed.join(", ")}.` : "Previous settings were restored."} ${String(error)}`,
			);
		}
		return this.get();
	}
}

/** Newly added accounts inherit only an explicitly saved GatedSpace choice. */
export function inheritClaudeCompaction(
	configDir: string,
	savedPath = preferencePath(),
): void {
	if (!existsSync(savedPath)) return;
	const preference = claudeCompactionPreference.parse(read(savedPath));
	const path = join(configDir, "settings.json");
	writeCompactionFile(
		path,
		JSON.stringify(applyCompaction(read(path), preference), null, 2),
	);
}
