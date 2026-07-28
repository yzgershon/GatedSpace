import { describe, expect, it } from "bun:test";
import {
	buildServeArgs,
	buildServeOffArgs,
	isHttpsDisabledError,
	normalizeDnsName,
	TAILSCALE_SERVE_PORT,
} from "./tailscale-serve";

/**
 * Command construction only. Nothing here runs `tailscale` — every one of these
 * commands changes machine-wide state that outlives the app, which is exactly
 * why the argument building is a pure function worth testing separately.
 */

describe("buildServeArgs", () => {
	it("points Tailscale at loopback, not at a routable address", () => {
		// Tailscale is meant to be the ONLY thing that can reach the bridge
		// directly; binding wider would leave the local network a second door.
		expect(buildServeArgs(51234)).toEqual([
			"serve",
			"--bg",
			`--https=${TAILSCALE_SERVE_PORT}`,
			"http://127.0.0.1:51234",
		]);
	});

	it("runs in the background so the call returns", () => {
		// Without --bg the command blocks until interrupted, which would hang
		// the bridge's start path forever.
		expect(buildServeArgs(3000)).toContain("--bg");
	});
});

describe("buildServeOffArgs", () => {
	it("turns off only our mapping", () => {
		// `serve reset` would wipe any other serve config on the machine. That
		// config is not ours to discard.
		expect(buildServeOffArgs()).toEqual([
			"serve",
			`--https=${TAILSCALE_SERVE_PORT}`,
			"off",
		]);
		expect(buildServeOffArgs()).not.toContain("reset");
	});
});

describe("normalizeDnsName", () => {
	it("drops the trailing dot Tailscale reports", () => {
		// Legal in a URL, but it looks broken in a link someone reads off a
		// screen.
		expect(normalizeDnsName("yishai-xps.taile80d57.ts.net.")).toBe(
			"yishai-xps.taile80d57.ts.net",
		);
	});

	it("leaves a name without one alone", () => {
		expect(normalizeDnsName("host.tail1234.ts.net")).toBe(
			"host.tail1234.ts.net",
		);
	});

	it("trims surrounding whitespace", () => {
		expect(normalizeDnsName("  host.ts.net.  ")).toBe("host.ts.net");
	});
});

describe("isHttpsDisabledError", () => {
	it("recognises the admin-console toggle failure", () => {
		// This is the one failure with a specific fix worth naming, and it is
		// what a first-time user hits.
		for (const message of [
			"HTTPS is disabled for your tailnet",
			"error: HTTPS is not enabled",
			"Enable HTTPS in the admin console",
			"HTTPS Certificates must be enabled",
		]) {
			expect(isHttpsDisabledError(message)).toBe(true);
		}
	});

	it("does not claim unrelated failures are the toggle", () => {
		// A wrong match here sends someone to fix a setting that was never the
		// problem.
		for (const message of [
			"permission denied",
			"tailscale: command not found",
			"failed to connect to local tailscaled",
			"",
		]) {
			expect(isHttpsDisabledError(message)).toBe(false);
		}
	});
});
