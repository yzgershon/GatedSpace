import { describe, expect, test } from "bun:test";
import {
	isLocalOnly,
	isUsableTelemetryKey,
	shouldEnableTelemetry,
} from "./telemetry-gate";

describe("isUsableTelemetryKey", () => {
	test("rejects the placeholder that was shipping in .env", () => {
		// The regression: this is a non-empty string, so the old `!key` gate
		// passed it and the app connected to PostHog on every launch.
		expect(isUsableTelemetryKey("phc_local_dev_disabled")).toBe(false);
	});

	test("rejects other common stand-ins", () => {
		for (const key of [
			"phc_placeholder",
			"phc_fake_key",
			"phc_dummy",
			"phc_example",
			"changeme",
			"your-api-key",
			"your_key",
			"phc_xxxxxxxx",
		]) {
			expect(isUsableTelemetryKey(key)).toBe(false);
		}
	});

	test("rejects absent and blank keys", () => {
		expect(isUsableTelemetryKey(undefined)).toBe(false);
		expect(isUsableTelemetryKey("")).toBe(false);
		expect(isUsableTelemetryKey("   ")).toBe(false);
	});

	test("accepts a key that looks real", () => {
		expect(isUsableTelemetryKey("phc_9aTbQ2mZ4LxV7pR1sK8dN3wY6cH0jF5g")).toBe(
			true,
		);
	});
});

describe("isLocalOnly", () => {
	test("accepts the usual truthy spellings", () => {
		for (const flag of ["1", "true", "TRUE", "yes", " true "]) {
			expect(isLocalOnly(flag)).toBe(true);
		}
	});

	test("treats absent, empty and 0 as not local-only", () => {
		for (const flag of [undefined, "", "0", "false", "no"]) {
			expect(isLocalOnly(flag)).toBe(false);
		}
	});
});

describe("shouldEnableTelemetry", () => {
	const REAL = "phc_9aTbQ2mZ4LxV7pR1sK8dN3wY6cH0jF5g";

	test("a local-only build never phones home, even with a real key", () => {
		// CI sets this for the public release, whose whole promise is that
		// nothing leaves the machine.
		expect(shouldEnableTelemetry({ key: REAL, localOnly: "1" })).toBe(false);
	});

	test("a placeholder key stays off in a normal build", () => {
		expect(
			shouldEnableTelemetry({
				key: "phc_local_dev_disabled",
				localOnly: undefined,
			}),
		).toBe(false);
	});

	test("enabled only with a real key in a non-local build", () => {
		expect(shouldEnableTelemetry({ key: REAL, localOnly: undefined })).toBe(
			true,
		);
	});
});
