import { describe, expect, it } from "bun:test";
import { hashName, projectAccent, projectInitial } from "./project-accent";

describe("hashName", () => {
	it("is stable for the same name", () => {
		// The colour has to survive a reload, and be the same on another machine
		// that opens the same project.
		expect(hashName("superset")).toBe(hashName("superset"));
	});

	it("separates names that share a prefix", () => {
		// Summing char codes collides badly here, which matters because the
		// sidebar's whole job is showing several similar names at once.
		expect(hashName("SecondBrain")).not.toBe(hashName("SecondBrain2"));
		expect(hashName("superset")).not.toBe(hashName("supersets"));
	});

	it("stays an unsigned 32-bit value", () => {
		for (const name of ["a", "yddetailers-site", "Tech-Transformation"]) {
			const hash = hashName(name);
			expect(hash).toBeGreaterThanOrEqual(0);
			expect(hash).toBeLessThan(2 ** 32);
			expect(Number.isInteger(hash)).toBe(true);
		}
	});
});

describe("projectAccent", () => {
	it("spreads names across the whole palette", () => {
		// NOT "these N names all differ" — with a fixed palette, collisions become
		// likely surprisingly fast and asserting otherwise would be testing luck.
		// What matters is that the hash does not clump: every stop should get
		// used, and none should swallow a large share.
		const names = Array.from({ length: 400 }, (_, i) => `project-${i}`);
		const counts = new Map<string, number>();
		for (const name of names) {
			const key = projectAccent(name).background;
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		expect(counts.size).toBe(16);
		const biggest = Math.max(...counts.values());
		// Even distribution would be 25 each; allow generous slack, catch clumping.
		expect(biggest).toBeLessThan(60);
	});

	it("is stable across calls", () => {
		expect(projectAccent("Flow")).toEqual(projectAccent("Flow"));
	});

	it("ignores surrounding whitespace", () => {
		expect(projectAccent("  Flow  ")).toEqual(projectAccent("Flow"));
	});

	it("falls back to theme tokens for a nameless project", () => {
		// Rather than hashing "" into an arbitrary colour that looks deliberate.
		expect(projectAccent("   ").background).toBe("var(--muted)");
	});

	it("uses one colour in both themes", () => {
		// It is an identity mark. A project changing colour with the theme would
		// undo the point of the colour being stable.
		expect(projectAccent("superset").foreground).not.toContain("var(");
	});
});

describe("projectInitial", () => {
	it("uppercases the first letter", () => {
		expect(projectInitial("superset")).toBe("S");
	});

	it("skips leading punctuation", () => {
		// "@scope/app" and "-internal" should not show as "@" and "-".
		expect(projectInitial("@scope/app")).toBe("S");
		expect(projectInitial("-internal")).toBe("I");
	});

	it("accepts a digit", () => {
		expect(projectInitial("2048-game")).toBe("2");
	});

	it("handles non-Latin names", () => {
		expect(projectInitial("проект")).toBe("П");
	});

	it("does not throw on an empty name", () => {
		expect(projectInitial("")).toBe("?");
	});
});
