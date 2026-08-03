import { describe, expect, test } from "bun:test";
import { isAllowedPushEndpoint } from "./push-endpoint";

describe("isAllowedPushEndpoint", () => {
	test("accepts the real push services", () => {
		for (const endpoint of [
			"https://fcm.googleapis.com/fcm/send/abc123",
			"https://updates.push.services.mozilla.com/wpush/v2/abc",
			"https://wns2-par02p.notify.windows.com/w/?token=abc",
			"https://web.push.apple.com/QK123",
		]) {
			expect(isAllowedPushEndpoint(endpoint)).toBe(true);
		}
	});

	test("refuses an arbitrary host", () => {
		// The finding: a caller with the bridge token could point the desktop's
		// per-event POSTs anywhere and get a beacon plus its source IP.
		expect(isAllowedPushEndpoint("https://evil.test/collect")).toBe(false);
	});

	test("refuses an internal host reachable only from this machine", () => {
		for (const endpoint of [
			"https://127.0.0.1:8080/x",
			"https://localhost/x",
			"https://192.168.1.1/admin",
			"https://169.254.169.254/latest/meta-data/",
		]) {
			expect(isAllowedPushEndpoint(endpoint)).toBe(false);
		}
	});

	test("is not fooled by a lookalike hostname", () => {
		// Suffix matching must be on a dot boundary.
		for (const endpoint of [
			"https://evilgoogleapis.com/x",
			"https://notify.windows.com.evil.test/x",
			"https://googleapis.com.attacker.test/x",
		]) {
			expect(isAllowedPushEndpoint(endpoint)).toBe(false);
		}
	});

	test("refuses non-https", () => {
		expect(isAllowedPushEndpoint("http://fcm.googleapis.com/x")).toBe(false);
		expect(isAllowedPushEndpoint("file:///etc/passwd")).toBe(false);
	});

	test("refuses credentials embedded in the URL", () => {
		// They would be sent on every agent event.
		expect(
			isAllowedPushEndpoint("https://user:pass@fcm.googleapis.com/x"),
		).toBe(false);
	});

	test("refuses non-strings and malformed URLs", () => {
		for (const value of [undefined, null, 42, {}, [], "", "not a url"]) {
			expect(isAllowedPushEndpoint(value)).toBe(false);
		}
	});

	test("is case-insensitive on the host", () => {
		expect(isAllowedPushEndpoint("https://FCM.GOOGLEAPIS.COM/x")).toBe(true);
	});
});
