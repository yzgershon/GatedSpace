import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
	addMagic,
	detectFormat,
	SAFE_STORAGE_MAGIC,
	stripMagic,
} from "./crypto-format";

describe("detectFormat", () => {
	test("recognises a safeStorage blob", () => {
		expect(detectFormat(addMagic(Buffer.from("ciphertext")))).toBe(
			"safe-storage",
		);
	});

	test("treats an unmarked blob as legacy", () => {
		// The existing on-disk shape: 16 salt + 12 iv + 16 tag + ciphertext.
		expect(detectFormat(randomBytes(64))).toBe("legacy-machine-id");
	});

	test("treats a blob shorter than the marker as legacy", () => {
		// Must not read past the end deciding this.
		expect(detectFormat(Buffer.alloc(3))).toBe("legacy-machine-id");
		expect(detectFormat(Buffer.alloc(0))).toBe("legacy-machine-id");
	});

	test("does not match a partial marker", () => {
		const almost = Buffer.concat([
			SAFE_STORAGE_MAGIC.subarray(0, SAFE_STORAGE_MAGIC.length - 1),
			Buffer.from([0xff]),
			Buffer.from("rest"),
		]);
		expect(detectFormat(almost)).toBe("legacy-machine-id");
	});
});

describe("addMagic / stripMagic", () => {
	test("round-trips the payload byte for byte", () => {
		const payload = randomBytes(128);
		expect(stripMagic(addMagic(payload)).equals(payload)).toBe(true);
	});

	test("round-trips an empty payload", () => {
		expect(stripMagic(addMagic(Buffer.alloc(0))).length).toBe(0);
	});

	test("the marker is a fixed 8 bytes", () => {
		// Changing this length would make every stored token unreadable, so
		// pin it deliberately.
		expect(SAFE_STORAGE_MAGIC.length).toBe(8);
	});

	test("a marked payload is longer than the payload by exactly the marker", () => {
		const payload = randomBytes(32);
		expect(addMagic(payload).length).toBe(payload.length + 8);
	});
});
