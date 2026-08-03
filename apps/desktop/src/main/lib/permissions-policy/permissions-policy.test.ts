import { describe, expect, test } from "bun:test";
import { decidePermission, isAppOrigin } from "./policy.ts";

describe("isAppOrigin", () => {
	test("recognises the packaged renderer", () => {
		expect(isAppOrigin("file:///C:/app/resources/index.html")).toBe(true);
	});

	test("recognises the dev server", () => {
		expect(isAppOrigin("http://localhost:5173/")).toBe(true);
		expect(isAppOrigin("http://127.0.0.1:5173/")).toBe(true);
	});

	test("does not recognise a page loaded from the network", () => {
		expect(isAppOrigin("https://example.com/")).toBe(false);
	});

	test("is not fooled by a hostname that merely contains localhost", () => {
		expect(isAppOrigin("https://localhost.evil.com/")).toBe(false);
		expect(isAppOrigin("https://notlocalhost/")).toBe(false);
	});

	test("rejects an unknown or missing origin", () => {
		expect(isAppOrigin(undefined)).toBe(false);
		expect(isAppOrigin("")).toBe(false);
		expect(isAppOrigin("not a url")).toBe(false);
	});
});

describe("decidePermission", () => {
	const APP = "file:///C:/app/index.html";
	const REMOTE = "https://example.com/";

	test("refuses camera and microphone even to our own UI", () => {
		expect(decidePermission("media", APP)).toBe(false);
	});

	test("refuses geolocation and device access to a remote page", () => {
		for (const permission of [
			"geolocation",
			"media",
			"midi",
			"hid",
			"serial",
			"usb",
			"idle-detection",
			"pointerLock",
		]) {
			expect(decidePermission(permission, REMOTE)).toBe(false);
		}
	});

	test("refuses clipboard reads to a remote page", () => {
		// The Browser pane shares the app partition, so this is the case that
		// matters: a page we are only previewing must not reach the clipboard.
		expect(decidePermission("clipboard-read", REMOTE)).toBe(false);
	});

	test("allows the handful our own renderer needs", () => {
		for (const permission of [
			"clipboard-read",
			"clipboard-sanitized-write",
			"fullscreen",
			"notifications",
		]) {
			expect(decidePermission(permission, APP)).toBe(true);
		}
	});

	test("denies an unknown permission rather than assuming it is harmless", () => {
		expect(decidePermission("some-future-capability", APP)).toBe(false);
	});

	test("denies when the origin is unknown", () => {
		expect(decidePermission("clipboard-read", undefined)).toBe(false);
	});
});
