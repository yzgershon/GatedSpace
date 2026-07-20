import { describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	getStatusLineState,
	installStatusLine,
	uninstallStatusLine,
} from "./claude-status-line";

function fixture(): {
	scriptPath: string;
	profiles: { id: string; label: string; configDir: string }[];
	settingsPath: (id: string) => string;
} {
	const root = mkdtempSync(join(tmpdir(), "status-line-"));
	const profiles = [
		{ id: "one", label: "One", configDir: join(root, ".claude") },
		{ id: "two", label: "Two", configDir: join(root, ".claude-two") },
	];
	return {
		scriptPath: join(root, ".superset", "claude-status-line.js"),
		profiles,
		settingsPath: (id) =>
			join(profiles.find((p) => p.id === id)?.configDir ?? "", "settings.json"),
	};
}

function writeSettings(configDir: string, value: unknown): void {
	mkdirSync(configDir, { recursive: true });
	writeFileSync(join(configDir, "settings.json"), JSON.stringify(value));
}

describe("claude status line install", () => {
	test("wires every account and reports installed", () => {
		const f = fixture();
		const state = installStatusLine(f);
		expect(state.installed).toBe(true);
		expect(existsSync(f.scriptPath)).toBe(true);
		for (const profile of f.profiles) {
			const settings = JSON.parse(
				readFileSync(f.settingsPath(profile.id), "utf8"),
			);
			expect(settings.statusLine.command).toContain("claude-status-line.js");
			expect(settings.statusLine.type).toBe("command");
		}
	});

	test("preserves unrelated settings keys", () => {
		const f = fixture();
		writeSettings(f.profiles[0]?.configDir ?? "", {
			model: "claude-opus-4-8",
			hooks: { SessionStart: [{ hooks: [{ type: "command", command: "x" }] }] },
			theme: "dark",
		});
		installStatusLine(f);
		const settings = JSON.parse(readFileSync(f.settingsPath("one"), "utf8"));
		expect(settings.model).toBe("claude-opus-4-8");
		expect(settings.theme).toBe("dark");
		expect(settings.hooks.SessionStart).toHaveLength(1);
		expect(settings.statusLine.command).toContain("claude-status-line.js");
	});

	test("never clobbers a status line the user configured themselves", () => {
		const f = fixture();
		const custom = "node C:/Users/someone/.claude/my-statusline.js";
		writeSettings(f.profiles[0]?.configDir ?? "", {
			statusLine: { type: "command", command: custom },
		});

		const state = installStatusLine(f);
		expect(state.hasCustom).toBe(true);
		expect(state.installed).toBe(false);
		expect(
			JSON.parse(readFileSync(f.settingsPath("one"), "utf8")).statusLine
				.command,
		).toBe(custom);
		// The account without a custom entry still gets wired.
		expect(state.profiles.find((p) => p.id === "two")?.wired).toBe(true);
	});

	test("replaces a custom status line only when explicitly asked", () => {
		const f = fixture();
		writeSettings(f.profiles[0]?.configDir ?? "", {
			statusLine: { type: "command", command: "node other.js" },
		});
		const state = installStatusLine({ ...f, replaceCustom: true });
		expect(state.installed).toBe(true);
		expect(
			JSON.parse(readFileSync(f.settingsPath("one"), "utf8")).statusLine
				.command,
		).toContain("claude-status-line.js");
	});

	test("uninstall removes only our entry and leaves other keys alone", () => {
		const f = fixture();
		writeSettings(f.profiles[0]?.configDir ?? "", { theme: "dark" });
		installStatusLine(f);
		const state = uninstallStatusLine(f);
		expect(state.installed).toBe(false);
		expect(existsSync(f.scriptPath)).toBe(false);
		const settings = JSON.parse(readFileSync(f.settingsPath("one"), "utf8"));
		expect(settings.statusLine).toBeUndefined();
		expect(settings.theme).toBe("dark");
	});

	test("uninstall keeps a custom status line", () => {
		const f = fixture();
		const custom = "node mine.js";
		writeSettings(f.profiles[0]?.configDir ?? "", {
			statusLine: { type: "command", command: custom },
		});
		uninstallStatusLine(f);
		expect(
			JSON.parse(readFileSync(f.settingsPath("one"), "utf8")).statusLine
				.command,
		).toBe(custom);
	});

	test("state reports not-installed before anything is wired", () => {
		const f = fixture();
		const state = getStatusLineState(f);
		expect(state.installed).toBe(false);
		expect(state.hasCustom).toBe(false);
		expect(state.profiles).toHaveLength(2);
	});
});
