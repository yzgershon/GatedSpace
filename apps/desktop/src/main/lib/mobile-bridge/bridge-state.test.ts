import { describe, expect, it } from "bun:test";
import { BRIDGE_DEFAULT_STATE, readBridgeState } from "./bridge-state";

/**
 * The switch that decides whether the phone can reach this machine at all.
 * Getting it wrong is only discoverable from the device you are away from.
 */

describe("the bridge default", () => {
	it("is on", () => {
		// Off-by-default means the bridge is never up when it is wanted, because
		// the machine that could turn it on is the one that was left behind.
		expect(BRIDGE_DEFAULT_STATE.enabled).toBe(true);
	});

	it("is the encrypted mode", () => {
		// Notifications and dictation both require a secure context, and LAN mode
		// carries the token in cleartext.
		expect(BRIDGE_DEFAULT_STATE.mode).toBe("tailscale-serve");
	});
});

describe("reading the stored state", () => {
	it("returns something usable even with nothing on disk", () => {
		const state = readBridgeState();
		expect(typeof state.enabled).toBe("boolean");
		expect(typeof state.mode).toBe("string");
	});

	it("hands back a copy, not the shared default", () => {
		// A caller mutating this would change the default for the whole process.
		const state = readBridgeState();
		expect(state).not.toBe(BRIDGE_DEFAULT_STATE);
	});
});
