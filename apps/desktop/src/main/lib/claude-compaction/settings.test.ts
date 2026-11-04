import { afterEach, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	applyCompaction,
	ClaudeCompactionSettings,
	inheritClaudeCompaction,
	inspectCompaction,
} from "./settings";

const roots: string[] = [];
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "gs-compaction-"));
	roots.push(root);
	const accounts = ["Default", "Work"].map((label) => ({
		label,
		configDir: join(root, label),
	}));
	for (const account of accounts) mkdirSync(account.configDir);
	const saved = join(root, "preference.json");
	return {
		root,
		accounts,
		saved,
		service: new ClaudeCompactionSettings(() => accounts, saved),
	};
}
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

test("custom window updates every account and survives service recreation", () => {
	const { accounts, saved, service } = fixture();
	const original = {
		permissions: { allow: ["Read"] },
		hooks: { Stop: [] },
		env: {
			PRIVATE_KEY: "fixture",
			CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "20",
			DISABLE_AUTO_COMPACT: "1",
		},
		modelSettings: { opus: { effortLevel: "high", autoCompactWindow: 250000 } },
	};
	writeFileSync(
		join(accounts[0].configDir, "settings.json"),
		JSON.stringify(original),
	);
	service.set({ mode: "custom", windowTokens: 500000 });
	const actual = JSON.parse(
		readFileSync(join(accounts[0].configDir, "settings.json"), "utf8"),
	);
	expect(actual.env).toMatchObject({
		PRIVATE_KEY: "fixture",
		CLAUDE_CODE_AUTO_COMPACT_WINDOW: "500000",
		DISABLE_AUTO_COMPACT: "0",
		CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: "100",
	});
	expect(actual.permissions).toEqual(original.permissions);
	expect(actual.hooks).toEqual(original.hooks);
	expect(actual.modelSettings.opus).toEqual({ effortLevel: "high" });
	expect(
		new ClaudeCompactionSettings(() => accounts, saved).get().preference,
	).toEqual({ mode: "custom", windowTokens: 500000 });
	expect(
		JSON.parse(
			readFileSync(
				join(accounts[0].configDir, "settings.json.gatedspace-compaction.bak"),
				"utf8",
			),
		),
	).toEqual(original);
});
test("off disables automatic compaction without disabling manual compact", () => {
	const settings = applyCompaction(
		{ autoCompactWindow: 250000 },
		{ mode: "off" },
	);
	expect(settings).toMatchObject({
		autoCompactEnabled: false,
		env: {
			DISABLE_AUTO_COMPACT: "1",
			DISABLE_COMPACT: "0",
			CLAUDE_CODE_AUTO_COMPACT_WINDOW: "",
		},
	});
	expect(inspectCompaction(settings)).toEqual({ mode: "off" });
});
test("default explicitly clears old live environment and per-model windows", () => {
	const settings = applyCompaction(
		{
			autoCompactWindow: 250000,
			env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "250000" },
			modelSettings: { opus: { autoCompactWindow: 250000 } },
		},
		{ mode: "default" },
	);
	expect(inspectCompaction(settings)).toEqual({ mode: "default" });
	expect(settings.env).toMatchObject({
		CLAUDE_CODE_AUTO_COMPACT_WINDOW: "",
		DISABLE_AUTO_COMPACT: "0",
	});
});

test("per-model windows are not misreported as the account's global window", () => {
	const settings = {
		autoCompactWindow: 250000,
		modelSettings: { opus: { autoCompactWindow: 750000 } },
	};
	expect(inspectCompaction(settings)).toBeNull();
	expect(
		inspectCompaction({
			...settings,
			env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "500000" },
		}),
	).toEqual({ mode: "custom", windowTokens: 500000 });
});
test("existing different account preferences are read without overwriting them", () => {
	const { accounts, service } = fixture();
	const path = join(accounts[0].configDir, "settings.json");
	writeFileSync(path, '{"autoCompactEnabled":false}');
	expect(service.get().preference).toBeNull();
	expect(readFileSync(path, "utf8")).toBe('{"autoCompactEnabled":false}');
});

test("saving an existing Off choice establishes inheritance for future accounts", () => {
	const { accounts, service } = fixture();
	for (const account of accounts)
		writeFileSync(
			join(account.configDir, "settings.json"),
			'{"autoCompactEnabled":false}',
		);
	expect(service.get().preference).toEqual({ mode: "off" });
	expect(service.get().savedPreference).toBeNull();
	expect(service.set({ mode: "off" }).savedPreference).toEqual({ mode: "off" });
});
test("invalid JSON in any account prevents every write", () => {
	const { accounts, saved, service } = fixture();
	writeFileSync(join(accounts[1].configDir, "settings.json"), "broken");
	expect(() => service.set({ mode: "off" })).toThrow("Fix its JSON");
	expect(existsSync(join(accounts[0].configDir, "settings.json"))).toBe(false);
	expect(existsSync(saved)).toBe(false);
});
test("out-of-range and fractional token counts cannot be saved", () => {
	const { service, saved } = fixture();
	for (const windowTokens of [0, 99999, 1000001, 500000.5, Number.NaN])
		expect(() => service.set({ mode: "custom", windowTokens })).toThrow();
	expect(existsSync(saved)).toBe(false);
});
test("write failure rolls back already updated accounts", () => {
	const { accounts, saved } = fixture();
	const first = join(accounts[0].configDir, "settings.json");
	writeFileSync(first, '{"autoCompactEnabled":false}');
	const service = new ClaudeCompactionSettings(
		() => accounts,
		saved,
		(path, data) => {
			if (path === join(accounts[1].configDir, "settings.json"))
				throw new Error("fixture write failure");
			writeFileSync(path, data);
		},
	);
	expect(() => service.set({ mode: "custom", windowTokens: 500000 })).toThrow(
		"Previous settings were restored",
	);
	expect(readFileSync(first, "utf8")).toBe('{"autoCompactEnabled":false}');
	expect(existsSync(saved)).toBe(false);
});
test("new accounts inherit an explicit choice and fresh installations stay untouched", () => {
	const { root, service, saved } = fixture();
	const fresh = join(root, "fresh");
	inheritClaudeCompaction(fresh, saved);
	expect(existsSync(fresh)).toBe(false);
	service.set({ mode: "custom", windowTokens: 500000 });
	inheritClaudeCompaction(fresh, saved);
	expect(
		inspectCompaction(
			JSON.parse(readFileSync(join(fresh, "settings.json"), "utf8")),
		),
	).toEqual({ mode: "custom", windowTokens: 500000 });
});
