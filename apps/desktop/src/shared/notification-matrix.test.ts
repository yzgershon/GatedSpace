import { describe, expect, it } from "bun:test";
import {
	createSoundThrottle,
	DEFAULT_NOTIFICATION_MATRIX,
	isChannelEnabled,
	NOTIFIABLE_EVENT_TYPES,
	parseNotificationMatrix,
	SOUND_THROTTLE_MS,
	serializeNotificationMatrix,
	soundBucketFor,
} from "./notification-matrix";

describe("DEFAULT_NOTIFICATION_MATRIX", () => {
	it("notifies on every channel, matching the behaviour before the matrix existed", () => {
		// Upgrading must not silently turn someone's notifications off.
		for (const eventType of NOTIFIABLE_EVENT_TYPES) {
			expect(DEFAULT_NOTIFICATION_MATRIX[eventType]).toEqual({
				sound: true,
				banner: true,
			});
		}
	});
});

describe("parseNotificationMatrix", () => {
	it("round-trips through serialize", () => {
		const matrix = parseNotificationMatrix(undefined);
		matrix.Stop.sound = false;
		expect(
			parseNotificationMatrix(serializeNotificationMatrix(matrix)),
		).toEqual(matrix);
	});

	it("hands back a matrix that does not alias the defaults", () => {
		// A shallow spread of the default leaves the per-channel objects shared,
		// so one caller flipping a switch would rewrite the default for every
		// later caller in the process.
		const mine = parseNotificationMatrix(undefined);
		mine.Stop.sound = false;
		expect(DEFAULT_NOTIFICATION_MATRIX.Stop.sound).toBe(true);
		expect(parseNotificationMatrix(undefined).Stop.sound).toBe(true);
	});

	it("falls back to defaults for junk rather than throwing", () => {
		for (const junk of ["not json", null, 42, [], "{"]) {
			expect(parseNotificationMatrix(junk)).toEqual(
				DEFAULT_NOTIFICATION_MATRIX,
			);
		}
	});

	it("fills in an event type the stored value has never heard of", () => {
		// This is the forward-compatibility case: a matrix saved before a new
		// event type existed must not blank the new one out.
		const partial = parseNotificationMatrix({
			Stop: { sound: false, banner: false },
		});
		expect(partial.Stop).toEqual({ sound: false, banner: false });
		expect(partial.PermissionRequest).toEqual({ sound: true, banner: true });
	});

	it("keeps a valid channel while repairing its broken sibling", () => {
		const repaired = parseNotificationMatrix({
			Stop: { sound: false, banner: "yes please" },
		});
		expect(repaired.Stop).toEqual({ sound: false, banner: true });
	});

	it("resolves a corrupt value towards notifying, not towards silence", () => {
		const repaired = parseNotificationMatrix({ Stop: "broken" });
		expect(repaired.Stop).toEqual({ sound: true, banner: true });
	});
});

describe("isChannelEnabled", () => {
	it("reads the matrix", () => {
		const matrix = parseNotificationMatrix({
			Stop: { sound: false, banner: true },
		});
		expect(isChannelEnabled(matrix, "Stop", "sound")).toBe(false);
		expect(isChannelEnabled(matrix, "Stop", "banner")).toBe(true);
	});

	it("says no to event types that are not notifiable", () => {
		// Start/Attached/Detached fire on every prompt and every agent boot.
		for (const eventType of ["Start", "Attached", "Detached", ""]) {
			expect(
				isChannelEnabled(DEFAULT_NOTIFICATION_MATRIX, eventType, "sound"),
			).toBe(false);
		}
	});
});

describe("soundBucketFor", () => {
	it("separates the events you must act on from the ones you just want to know", () => {
		expect(soundBucketFor("PermissionRequest")).toBe("attention");
		expect(soundBucketFor("PendingQuestion")).toBe("attention");
		expect(soundBucketFor("Stop")).toBe("completion");
	});
});

describe("createSoundThrottle", () => {
	it("plays the first of a burst immediately", () => {
		// Leading edge: the sound must arrive WITH the moment, not after it.
		expect(createSoundThrottle().shouldPlay("Stop", 1000)).toBe(true);
	});

	it("drops the rest of the burst", () => {
		const throttle = createSoundThrottle();
		expect(throttle.shouldPlay("Stop", 1000)).toBe(true);
		expect(throttle.shouldPlay("Stop", 1100)).toBe(false);
		expect(throttle.shouldPlay("Stop", 1000 + SOUND_THROTTLE_MS - 1)).toBe(
			false,
		);
	});

	it("reopens once the window passes", () => {
		const throttle = createSoundThrottle();
		expect(throttle.shouldPlay("Stop", 1000)).toBe(true);
		expect(throttle.shouldPlay("Stop", 1000 + SOUND_THROTTLE_MS)).toBe(true);
	});

	it("never lets a completion silence a permission prompt", () => {
		// The whole reason for two buckets: the app must not be quietest at the
		// exact moment an agent is blocked waiting for you.
		const throttle = createSoundThrottle();
		expect(throttle.shouldPlay("Stop", 1000)).toBe(true);
		expect(throttle.shouldPlay("PermissionRequest", 1010)).toBe(true);
	});

	it("still throttles within the attention bucket", () => {
		const throttle = createSoundThrottle();
		expect(throttle.shouldPlay("PermissionRequest", 1000)).toBe(true);
		expect(throttle.shouldPlay("PendingQuestion", 1010)).toBe(false);
	});

	it("does not go mute when the clock jumps backwards", () => {
		// Sleep/resume and NTP corrections both do this; a naive `now - previous`
		// goes negative and would suppress every sound until real time caught up.
		const throttle = createSoundThrottle();
		expect(throttle.shouldPlay("Stop", 10_000)).toBe(true);
		expect(throttle.shouldPlay("Stop", 5_000)).toBe(true);
	});
});
