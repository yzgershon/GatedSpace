import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type BuildJob,
	buildJobSchema,
	buildRevision,
} from "../../../shared/build-status";
import {
	dismissBuild,
	heartbeatBuild,
	observeBuildJobs,
	readBuildJobs,
	writeBuildJob,
} from "./store";

const directories: string[] = [];
const createDirectory = () => {
	const path = mkdtempSync(join(tmpdir(), "gatedspace-build-test-"));
	directories.push(path);
	return path;
};
afterEach(() => {
	for (const path of directories.splice(0))
		rmSync(path, { recursive: true, force: true });
});
const job = (overrides: Partial<BuildJob> = {}): BuildJob => ({
	id: "personal-31",
	version: "1.18.31",
	channel: "personal",
	architectures: ["arm64"],
	sourceCommit: "1234abcd",
	stage: "building",
	message: "Compiling",
	updatedAt: new Date().toISOString(),
	verified: false,
	published: false,
	...overrides,
});

describe("persistent installer status", () => {
	test("never accepts ready before verification and public publication", () => {
		expect(buildJobSchema.safeParse(job({ stage: "ready" })).success).toBe(
			false,
		);
		expect(
			buildJobSchema.safeParse(
				job({ stage: "ready", verified: true, channel: "public" }),
			).success,
		).toBe(false);
		expect(
			buildJobSchema.safeParse(
				job({
					stage: "ready",
					verified: true,
					channel: "public",
					published: true,
				}),
			).success,
		).toBe(true);
	});
	test("survives reopen, dismisses only the exact terminal revision and resurfaces retries", () => {
		const directory = createDirectory();
		const ready = writeBuildJob(
			directory,
			job({ stage: "ready", verified: true }),
		);
		expect(readBuildJobs(directory)).toEqual([ready]);
		dismissBuild(directory, ready.id, "outdated");
		expect(readBuildJobs(directory)).toHaveLength(1);
		dismissBuild(directory, ready.id, buildRevision(ready));
		expect(readBuildJobs(directory)).toEqual([]);
		const retry = writeBuildJob(directory, job());
		dismissBuild(directory, retry.id, buildRevision(retry));
		expect(readBuildJobs(directory)[0]?.stage).toBe("building");
	});
	test("stopped heartbeats surface attention, active heartbeats recover without fabricating success", () => {
		const directory = createDirectory();
		writeBuildJob(
			directory,
			job({ updatedAt: new Date(Date.now() - 180_000).toISOString() }),
		);
		expect(readBuildJobs(directory)[0]?.stage).toBe("failed");
		heartbeatBuild(directory, "personal-31");
		expect(readBuildJobs(directory)[0]?.stage).toBe("building");
	});
	test("rejects traversal and unexpected external links; ignores broken local records", () => {
		const directory = createDirectory();
		expect(() => writeBuildJob(directory, job({ id: "../escape" }))).toThrow();
		expect(() =>
			writeBuildJob(
				directory,
				job({ url: "https://github.com.evil.example/" }),
			),
		).toThrow();
		writeFileSync(join(directory, "invalid.json"), "{");
		writeFileSync(join(directory, "oversized.json"), "x".repeat(17000));
		expect(readBuildJobs(directory)).toEqual([]);
	});
	test("live watcher delivers phase and dismiss changes then unsubscribes", async () => {
		const directory = createDirectory();
		const events: BuildJob[][] = [];
		const stop = observeBuildJobs(directory, (jobs) => events.push(jobs));
		try {
			writeBuildJob(directory, job());
			await Bun.sleep(180);
			expect(events.at(-1)?.[0]?.stage).toBe("building");
			const ready = writeBuildJob(
				directory,
				job({ stage: "ready", verified: true }),
			);
			await Bun.sleep(180);
			expect(events.at(-1)?.[0]?.stage).toBe("ready");
			dismissBuild(directory, ready.id, buildRevision(ready));
			await Bun.sleep(180);
			expect(events.at(-1)).toEqual([]);
		} finally {
			stop();
		}
	});
});
