import { describe, expect, it } from "bun:test";
import {
	isDefaultWorkspaceName,
	nextDefaultWorkspaceName,
	parseDefaultWorkspaceNumber,
} from "./default-workspace-name";

describe("recognising a default name", () => {
	it("accepts the names it hands out", () => {
		expect(isDefaultWorkspaceName(nextDefaultWorkspaceName([]))).toBe(true);
	});

	it("rejects names that merely start the same way", () => {
		// "Workspace 2 — billing" is a name someone CHOSE. Treating it as a
		// default would let the counter overwrite it on a retry.
		expect(isDefaultWorkspaceName("Workspace 2 — billing")).toBe(false);
		expect(isDefaultWorkspaceName("My Workspace 2")).toBe(false);
		expect(isDefaultWorkspaceName("Workspace")).toBe(false);
		expect(isDefaultWorkspaceName("workspace 2")).toBe(false);
	});

	it("reads the number back out", () => {
		expect(parseDefaultWorkspaceNumber("Workspace 7")).toBe(7);
		expect(parseDefaultWorkspaceNumber("feature/login")).toBe(null);
	});
});

describe("allocating the next number", () => {
	it("starts at 1 in an empty project", () => {
		expect(nextDefaultWorkspaceName([])).toBe("Workspace 1");
	});

	it("continues from the highest in use", () => {
		expect(nextDefaultWorkspaceName(["Workspace 1", "Workspace 2"])).toBe(
			"Workspace 3",
		);
	});

	it("does not reissue a number after a gap opens", () => {
		// The whole reason this is max+1 and not a row count: deleting the
		// middle workspace leaves two rows, and counting them would collide
		// head-on with the surviving "Workspace 3".
		expect(nextDefaultWorkspaceName(["Workspace 1", "Workspace 3"])).toBe(
			"Workspace 4",
		);
	});

	it("ignores hand-picked names instead of counting them", () => {
		// Renaming everything to real names must not drag the counter back to 1
		// and collide with whatever is left.
		expect(
			nextDefaultWorkspaceName(["billing rewrite", "Workspace 5", "hotfix"]),
		).toBe("Workspace 6");
	});

	it("gives every hand-picked name the same treatment", () => {
		expect(nextDefaultWorkspaceName(["billing", "hotfix"])).toBe("Workspace 1");
	});

	it("survives a name that looks numeric but is not a real number", () => {
		// A pathological name should not produce "Workspace NaN".
		const name = nextDefaultWorkspaceName(["Workspace 00", "Workspace 1"]);
		expect(name).toBe("Workspace 2");
	});
});
