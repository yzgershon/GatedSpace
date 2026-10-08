import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BuildCheckpoints } from "./build-checkpoints";

test("a failed verification resumes without rebuilding verified inputs; modified output is rebuilt", async () => {
	const directory = mkdtempSync(join(tmpdir(), "gs-build-checkpoints-"));
	try {
		const journal = join(directory, "steps.json");
		const artifact = join(directory, "app");
		let builds = 0;
		const build = async () => {
			builds++;
			writeFileSync(artifact, "compiled");
		};
		const first = new BuildCheckpoints(journal);
		await first.run("compile", "source", [artifact], build);
		await expect(
			first.run("verify", "checks", [], async () => {
				throw new Error("fixture failure");
			}),
		).rejects.toThrow("fixture failure");
		const resumed = new BuildCheckpoints(journal);
		await resumed.run("compile", "source", [artifact], build);
		expect(builds).toBe(1);
		expect(resumed.timings[0]?.reused).toBe(true);
		writeFileSync(artifact, "altered!");
		await resumed.run("compile", "source", [artifact], build);
		expect(builds).toBe(2);
		await resumed.run("compile", "changed source", [artifact], build);
		expect(builds).toBe(3);
		expect(JSON.parse(readFileSync(journal, "utf8")).verify).toBeUndefined();
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("an interrupted build cannot reuse an old checkpoint even if it left an identical output", async () => {
	const directory = mkdtempSync(join(tmpdir(), "gs-build-interrupted-"));
	try {
		const journal = join(directory, "steps.json");
		const artifact = join(directory, "app");
		writeFileSync(artifact, "old");
		const steps = new BuildCheckpoints(journal);
		await steps.run("compile", "old", [artifact], async () => {});
		await expect(
			steps.run("compile", "new", [artifact], async () => {
				throw new Error("interrupted");
			}),
		).rejects.toThrow();
		let ran = false;
		await new BuildCheckpoints(journal).run(
			"compile",
			"old",
			[artifact],
			async () => {
				ran = true;
			},
		);
		expect(ran).toBe(true);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
