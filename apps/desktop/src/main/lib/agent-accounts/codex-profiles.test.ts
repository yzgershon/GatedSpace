import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountNickname, CodexProfiles } from "./codex-profiles";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

test("nicknames are required, bounded and distinct regardless of case", () => {
	expect(accountNickname("  Personal  ")).toBe("Personal");
	for (const name of ["", "  ", "x".repeat(41), "Work\nOther"])
		expect(() => accountNickname(name)).toThrow();
	expect(() => accountNickname("work", ["Work"])).toThrow("already in use");
});
test("account defaults and conversation bindings survive restarts independently", () => {
	const root = mkdtempSync(join(tmpdir(), "gs-accounts-test-"));
	roots.push(root);
	const profiles = new CodexProfiles(root, join(root, "original"));
	const work = profiles.add("Work");
	profiles.bind("original-thread", "default");
	profiles.select(work.id);
	const reopened = new CodexProfiles(root, join(root, "original"));
	expect(reopened.resolve()).toBe(work.id);
	expect(reopened.resolve("original-thread")).toBe("default");
	expect(reopened.resolve("older-unbound-thread")).toBe("default");
	profiles.bind("original-thread", work.id);
	expect(reopened.resolve("original-thread")).toBe(work.id);
	expect(readFileSync(join(root, "profiles.json"), "utf8")).not.toContain(
		"access_token",
	);
	expect(() => profiles.select("missing")).toThrow();
});
test("a corrupt registry fails visibly instead of changing the selected account", () => {
	const root = mkdtempSync(join(tmpdir(), "gs-accounts-test-"));
	roots.push(root);
	writeFileSync(join(root, "profiles.json"), "{}");
	expect(() => new CodexProfiles(root).resolve()).toThrow("Could not read");
});
