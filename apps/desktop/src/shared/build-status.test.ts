import { expect, test } from "bun:test";
import { type BuildJob, primaryBuild } from "./build-status";

test("old failure stays in history without masking the current installer", () => {
	const old: BuildJob = {
		id: "old",
		version: "1.18.37",
		channel: "personal",
		architectures: ["arm64"],
		sourceCommit: "123abcd",
		stage: "failed",
		message: "Previous failure",
		updatedAt: "2026-10-01T00:00:00.000Z",
		verified: false,
		published: false,
	};
	const current: BuildJob = {
		...old,
		id: "current",
		version: "1.18.39",
		stage: "building",
		updatedAt: "2026-10-07T00:00:00.000Z",
	};
	expect(primaryBuild([old, current])?.stage).toBe("building");
	expect(
		primaryBuild([old, { ...current, stage: "ready", verified: true }])?.stage,
	).toBe("ready");
	expect(primaryBuild([old, { ...current, stage: "failed" }])?.id).toBe(
		"current",
	);
	expect(primaryBuild([])).toBeUndefined();
});
