import { describe, expect, test } from "bun:test";
import {
	assertChannelAllowed,
	isChannelAllowed,
	RECEIVE_CHANNELS,
} from "./ipc-allowlist";

describe("isChannelAllowed", () => {
	test("permits the one channel the renderer actually listens on", () => {
		expect(isChannelAllowed("receive", "deep-link-navigate")).toBe(true);
	});

	test("keeps each channel to its own direction", () => {
		// Deep links are main -> renderer only.
		expect(isChannelAllowed("invoke", "deep-link-navigate")).toBe(false);
		expect(isChannelAllowed("send", "deep-link-navigate")).toBe(false);
		// Persistence is renderer -> main only, and never fire-and-forget.
		expect(isChannelAllowed("receive", "tanstack-db:sqlite-persistence")).toBe(
			false,
		);
		expect(isChannelAllowed("send", "tanstack-db:sqlite-persistence")).toBe(
			false,
		);
	});

	test("permits the TanStack DB persistence bridge", () => {
		// Registered by exposeElectronSQLitePersistence inside the npm package
		// rather than by app code, so a grep for `ipcMain.handle` across
		// apps/desktop does not find it. Dropping it from the allowlist makes
		// every collection write throw in the preload — exactly what shipped
		// in 1.17.33.
		expect(isChannelAllowed("invoke", "tanstack-db:sqlite-persistence")).toBe(
			true,
		);
	});

	test("refuses channels belonging to Electron and dependencies", () => {
		// The actual prize for an attacker: these exist in the process whether
		// or not the app registers anything of its own.
		for (const channel of [
			"ELECTRON_BROWSER_REQUIRE",
			"ELECTRON_BROWSER_GET_BUILTIN",
			"ELECTRON_BROWSER_MEMBER_CALL",
			"sentry-electron",
			"electron-trpc",
		]) {
			expect(isChannelAllowed("invoke", channel)).toBe(false);
			expect(isChannelAllowed("send", channel)).toBe(false);
			expect(isChannelAllowed("receive", channel)).toBe(false);
		}
	});

	test("refuses a non-string channel", () => {
		for (const value of [undefined, null, 42, {}, [], true]) {
			expect(isChannelAllowed("receive", value)).toBe(false);
		}
	});

	test("matches exactly — no prefix or substring escape", () => {
		expect(isChannelAllowed("receive", "deep-link-navigate-evil")).toBe(false);
		expect(isChannelAllowed("receive", "x-deep-link-navigate")).toBe(false);
		expect(isChannelAllowed("receive", "deep-link")).toBe(false);
	});

	test("the receive list stays minimal", () => {
		// A guard against the list quietly growing: anything added here should
		// be a deliberate decision, not a drive-by.
		expect([...RECEIVE_CHANNELS]).toEqual(["deep-link-navigate"]);
	});
});

describe("assertChannelAllowed", () => {
	test("passes an allowed channel through", () => {
		expect(() =>
			assertChannelAllowed("receive", "deep-link-navigate"),
		).not.toThrow();
	});

	test("throws naming the channel, so a real need is easy to diagnose", () => {
		expect(() => assertChannelAllowed("invoke", "some-channel")).toThrow(
			/some-channel/,
		);
		expect(() => assertChannelAllowed("invoke", "some-channel")).toThrow(
			/INVOKE_CHANNELS/,
		);
	});
});
