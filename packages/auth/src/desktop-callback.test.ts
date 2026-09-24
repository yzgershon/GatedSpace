import { expect, test } from "bun:test";
import { desktopCallbackTarget } from "./desktop-callback";

test("installed and workspace callbacks stay on the local desktop", () => {
	expect(
		desktopCallbackTarget("gatedspace", "http://127.0.0.1:3142/auth/callback"),
	).toEqual({
		protocol: "gatedspace",
		localCallback: "http://127.0.0.1:3142/auth/callback",
	});
	expect(desktopCallbackTarget("superset-my-worktree").protocol).toBe(
		"superset-my-worktree",
	);
});
test("modified success-page URLs cannot send tokens to arbitrary websites", () => {
	for (const url of [
		"https://evil.example/auth/callback",
		"http://localhost.evil.example:3000/auth/callback",
		"http://127.0.0.1:3000/auth/callback?next=https://evil.example",
		"http://user@127.0.0.1:3000/auth/callback",
		"http://127.0.0.1:3000/other",
	])
		expect(() => desktopCallbackTarget("gatedspace", url)).toThrow();
	for (const protocol of ["https", "javascript", "gatedspace://evil"])
		expect(() => desktopCallbackTarget(protocol)).toThrow();
});
