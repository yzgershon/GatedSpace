import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
	buildFocusSurfaceRecord,
	focusSurfacePath,
	isFocusSurface,
} from "./focus-surface-file";

describe("isFocusSurface", () => {
	it("accepts the three surfaces", () => {
		expect(isFocusSurface("terminal")).toBe(true);
		expect(isFocusSurface("text")).toBe(true);
		expect(isFocusSurface("other")).toBe(true);
	});

	it("rejects anything else", () => {
		// The reader is a different program in a different language; this is the
		// contract boundary, so it validates rather than trusts.
		for (const junk of ["Terminal", "", null, undefined, 1, {}]) {
			expect(isFocusSurface(junk)).toBe(false);
		}
	});
});

describe("buildFocusSurfaceRecord", () => {
	it("carries a timestamp so a reader can ignore a dead app's file", () => {
		const record = buildFocusSurfaceRecord("text", 1_700_000_000_000, 4242);
		expect(record).toEqual({
			surface: "text",
			at: 1_700_000_000_000,
			pid: 4242,
		});
	});

	it("serialises to something a non-JS reader can parse", () => {
		const parsed = JSON.parse(
			JSON.stringify(buildFocusSurfaceRecord("terminal", 1, 2)),
		);
		expect(parsed.surface).toBe("terminal");
		expect(typeof parsed.at).toBe("number");
	});
});

describe("focusSurfacePath", () => {
	it("sits in the superset home directory", () => {
		// GatedVoice resolves the same path independently, so this name is a
		// contract with it and not an implementation detail.
		expect(focusSurfacePath("/tmp/superset-home")).toBe(
			join("/tmp/superset-home", "focus-surface.json"),
		);
	});
});
