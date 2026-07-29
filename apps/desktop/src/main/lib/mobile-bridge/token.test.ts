import { describe, expect, it } from "bun:test";
import {
	generateBridgeToken,
	loadOrCreateBridgeToken,
	tokensMatch,
} from "./token";

describe("generateBridgeToken", () => {
	it("is long, URL-safe, and different every time", () => {
		const a = generateBridgeToken();
		const b = generateBridgeToken();
		expect(a).not.toBe(b);
		expect(a.length).toBeGreaterThanOrEqual(43);
		// base64url: no +, / or = to be mangled in a URL or QR code.
		expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
	});
});

describe("loadOrCreateBridgeToken", () => {
	it("returns the same token every time it is asked", () => {
		// This is the whole fix for "this link has expired". The bridge starts on
		// every app launch, and a token minted per start meant the phone's saved
		// link was dead by the next morning.
		expect(loadOrCreateBridgeToken()).toBe(loadOrCreateBridgeToken());
	});

	it("returns something that would pass its own check", () => {
		expect(
			tokensMatch(loadOrCreateBridgeToken(), loadOrCreateBridgeToken()),
		).toBe(true);
	});
});

describe("tokensMatch", () => {
	it("accepts the right token", () => {
		const token = generateBridgeToken();
		expect(tokensMatch(token, token)).toBe(true);
	});

	it("rejects a wrong one, including a correct prefix", () => {
		const token = generateBridgeToken();
		expect(tokensMatch(token, token.slice(0, -1))).toBe(false);
		expect(tokensMatch(token, `${token}x`)).toBe(false);
		expect(tokensMatch(token, generateBridgeToken())).toBe(false);
	});

	it("rejects anything that is not a string", () => {
		// Query params arrive as string | string[] | undefined, and an array
		// slipping through as 'provided' must not compare equal to anything.
		const token = generateBridgeToken();
		expect(tokensMatch(token, undefined)).toBe(false);
		expect(tokensMatch(token, [token])).toBe(false);
		expect(tokensMatch(token, { toString: () => token })).toBe(false);
	});

	it("refuses when no token has been set", () => {
		// The dangerous case: an empty expected token must not turn into "match
		// anything", which is how a disabled bridge becomes an open one.
		expect(tokensMatch("", "")).toBe(false);
		expect(tokensMatch("", "anything")).toBe(false);
	});
});
