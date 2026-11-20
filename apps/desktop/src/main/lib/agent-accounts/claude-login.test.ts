import { expect, test } from "bun:test";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
	ClaudeBrowserLogin,
	type ClaudeLoginProgress,
	claudeAuthUrl,
} from "./claude-login";

function processFixture() {
	const child = Object.assign(new EventEmitter(), {
		stdin: new PassThrough(),
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		killed: false,
		kill() {
			child.killed = true;
			child.emit("close", 1);
			return true;
		},
	});
	return child as unknown as ChildProcessWithoutNullStreams & {
		stdin: PassThrough;
		stdout: PassThrough;
		stderr: PassThrough;
	};
}
test("browser/code fallback supports split CLI output and verifies saved login", async () => {
	const first = processFixture(),
		check = processFixture();
	const updates: ClaudeLoginProgress[] = [];
	const calls: string[][] = [];
	const login = new ClaudeBrowserLogin(
		"test-profile",
		(state) => updates.push(state),
		(args, home) => {
			expect(home).toBe("test-profile");
			calls.push(args);
			return calls.length === 1 ? first : check;
		},
	);
	const done = login.run();
	first.stdout.write("Open https://claude.com/oauth/");
	first.stdout.write("authorize?state=fixture\nPaste code here if prompted: ");
	expect(
		updates.some(
			(v) => v.authUrl === "https://claude.com/oauth/authorize?state=fixture",
		),
	).toBe(true);
	login.submitCode("fixture-code#fixture-state");
	expect(first.stdin.read().toString()).toBe("fixture-code#fixture-state\n");
	expect(() => login.submitCode("duplicate")).toThrow("not waiting");
	expect(JSON.stringify(updates)).not.toContain("fixture-code");
	first.emit("close", 0);
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(calls[1]).toEqual(["status", "--json"]);
	// Node may report exit before the last stdout chunk arrives.
	check.emit("exit", 0);
	check.stdout.write('{"loggedIn":true}');
	check.emit("close", 0);
	await done;
});
test("a failed code input pipe rejects without an unhandled stream error", async () => {
	const child = processFixture();
	const login = new ClaudeBrowserLogin(
		"test",
		() => {},
		() => child,
	);
	const done = login.run();
	child.stdin.emit("error", new Error("Input pipe closed"));
	await expect(done).rejects.toThrow("Input pipe closed");
	login.cancel();
});
test("cancelled sign-in cannot accept a stale code or spawn verification", async () => {
	const first = processFixture();
	let launched = 0;
	const login = new ClaudeBrowserLogin(
		"test",
		() => {},
		() => {
			launched++;
			return first;
		},
	);
	const done = login.run();
	first.stdout.write("Paste code here: ");
	login.cancel();
	await expect(done).rejects.toThrow();
	expect(() => login.submitCode("old-code")).toThrow("not waiting");
	expect(launched).toBe(1);
});
test("a zero exit from login alone does not mean signed in", async () => {
	const first = processFixture(),
		check = processFixture();
	let launched = 0;
	const login = new ClaudeBrowserLogin(
		"test",
		() => {},
		() => (++launched === 1 ? first : check),
	);
	const done = login.run();
	first.emit("close", 0);
	await new Promise((resolve) => setTimeout(resolve, 0));
	check.stdout.write('{"loggedIn":false}');
	check.emit("close", 0);
	await expect(done).rejects.toThrow("could not be verified");
});
test("only official Claude auth URLs can be opened", () => {
	expect(
		claudeAuthUrl("https://claude.com/oauth/authorize?state=x"),
	).toBeDefined();
	for (const value of [
		"http://claude.com/oauth/authorize",
		"https://claude.com.evil.test/oauth",
		"https://user@claude.com/oauth",
		"file:///oauth",
		"https://claude.com/docs",
		"https://claude.com:444/oauth",
	])
		expect(claudeAuthUrl(value)).toBeUndefined();
});
