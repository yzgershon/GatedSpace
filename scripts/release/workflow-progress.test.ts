import { expect, test } from "bun:test";
import {
	type BuildJob,
	buildJobSchema,
	buildProgress,
} from "../../apps/desktop/src/shared/build-status";
import { phaseProgress } from "./phase-progress";
import { workflowProgress } from "./workflow-progress";

test("counts real completed steps and reserves publication", () => {
	expect(
		workflowProgress([
			{
				name: "build / Build - Windows (x64)",
				steps: [{ status: "completed" }, { status: "in_progress" }],
			},
			{
				name: "build / Build - Windows (arm64)",
				steps: [{ status: "completed" }],
			},
		]),
	).toEqual({ completed: 2, total: 5, basis: "steps" });
	expect(workflowProgress([])).toBeUndefined();
	expect(
		workflowProgress([
			{
				name: "build / Build - Windows (x64)",
				steps: [{ status: "completed" }],
			},
		]),
	).toBeUndefined();
	expect(
		workflowProgress([
			{
				name: "build / Build - Windows (x64)",
				steps: [{ status: "completed" }],
			},
			{
				name: "build / Build - Windows (arm64)",
				steps: [{ status: "completed" }],
			},
			{
				name: "Create GitHub Release",
				status: "completed",
				steps: [{ status: "completed" }, { status: "completed" }],
			},
		]),
	).toEqual({ completed: 3, total: 4, basis: "steps" });
});
test("never reports completion before a verified ready state", () => {
	const job: BuildJob = {
		id: "test",
		version: "1.2.3",
		channel: "personal",
		architectures: ["arm64"],
		sourceCommit: "123abcd",
		stage: "building",
		message: "Test",
		updatedAt: new Date().toISOString(),
		verified: false,
		published: false,
		progress: { completed: 10, total: 10 },
	};
	expect(buildProgress(job)).toBe(99);
	expect(buildJobSchema.safeParse({ ...job, stage: "ready" }).success).toBe(
		false,
	);
	expect(buildProgress({ ...job, stage: "ready", verified: true })).toBe(100);
	expect(
		buildJobSchema.safeParse({ ...job, progress: { completed: 4, total: 3 } })
			.success,
	).toBe(false);
});
test("estimates only from measured timings and waits for a long-running phase", () => {
	expect(phaseProgress([undefined, 1000], 1, 500).basis).toBe("steps");
	const current = phaseProgress([1000, 2000], 1, 1000);
	expect(current.completed).toBe(2000);
	expect(current.basis).toBe("timing-estimate");
	expect(current.estimatedRemainingMs).toBe(31000);
	const overdue = phaseProgress([1000, 2000], 1, 10000);
	expect(overdue.completed).toBe(2800);
	expect(overdue.estimatedRemainingMs).toBeUndefined();
});
