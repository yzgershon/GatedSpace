/**
 * Tests for the bucketing, which is the part with real judgement in it.
 *
 * The buckets are not cosmetic: they are what the next launch reads to decide
 * how much to restore, and what a crash report groups on. A boundary that
 * lands on the wrong side turns "crashed on startup" into "crashed after an
 * hour", which is a different bug entirely.
 */
import { describe, expect, test } from "bun:test";
import { bucketCount, bucketMemory, bucketRuntime } from "./crash-sentinel";

const MB = 1024 * 1024;

describe("bucketMemory", () => {
	test("groups by the sizes that actually hurt", () => {
		expect(bucketMemory(120 * MB)).toBe("<500MB");
		expect(bucketMemory(700 * MB)).toBe("0.5-1GB");
		expect(bucketMemory(1500 * MB)).toBe("1-2GB");
		expect(bucketMemory(3000 * MB)).toBe("2-4GB");
		expect(bucketMemory(9000 * MB)).toBe(">4GB");
	});

	test("boundaries fall into the higher bucket, not the lower one", () => {
		// 500MB exactly is no longer "under 500MB". Getting this backwards would
		// under-report pressure at precisely the point it starts mattering.
		expect(bucketMemory(500 * MB)).toBe("0.5-1GB");
		expect(bucketMemory(1024 * MB)).toBe("1-2GB");
		expect(bucketMemory(4096 * MB)).toBe(">4GB");
	});

	test("zero and nonsense don't throw", () => {
		expect(bucketMemory(0)).toBe("<500MB");
		expect(bucketMemory(-1)).toBe("<500MB");
	});
});

describe("bucketCount", () => {
	test("separates none, one, and a handful", () => {
		expect(bucketCount(0)).toBe("0");
		expect(bucketCount(1)).toBe("1");
		expect(bucketCount(3)).toBe("2-4");
		expect(bucketCount(7)).toBe("5-9");
		expect(bucketCount(15)).toBe("10-19");
		expect(bucketCount(50)).toBe("20+");
	});

	test("one is its own bucket", () => {
		// "one terminal open" and "four terminals open" are different situations
		// when deciding what to restore; lumping them loses the distinction.
		expect(bucketCount(1)).not.toBe(bucketCount(2));
	});

	test("negative counts read as none", () => {
		expect(bucketCount(-3)).toBe("0");
	});
});

describe("bucketRuntime", () => {
	test("a startup crash and a long-run crash are never the same bucket", () => {
		// This is the distinction the whole ladder exists for.
		expect(bucketRuntime(10_000)).toBe("30s");
		expect(bucketRuntime(8 * 60 * 60_000)).toBe("16h+");
		expect(bucketRuntime(10_000)).not.toBe(bucketRuntime(8 * 60 * 60_000));
	});

	test("climbs through the ladder", () => {
		expect(bucketRuntime(60_000)).toBe("2min");
		expect(bucketRuntime(3 * 60_000)).toBe("5min");
		expect(bucketRuntime(10 * 60_000)).toBe("15min");
		expect(bucketRuntime(20 * 60_000)).toBe("30min");
		expect(bucketRuntime(45 * 60_000)).toBe("1h");
		expect(bucketRuntime(90 * 60_000)).toBe("2h");
		expect(bucketRuntime(180 * 60_000)).toBe("4h");
		expect(bucketRuntime(300 * 60_000)).toBe("8h");
	});

	test("an instant death is the smallest bucket, not an error", () => {
		expect(bucketRuntime(0)).toBe("30s");
	});
});
