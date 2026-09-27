import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

for (const scenario of [
	"verified",
	"unverified",
	"failed",
	"missing",
] as const) {
	test(`detached build reporter: ${scenario}`, () => {
		const directory = mkdtempSync(join(tmpdir(), "gs-reporter-test-"));
		try {
			const input = join(directory, "input.json");
			const records = join(directory, "records");
			writeFileSync(
				input,
				JSON.stringify({
					id: "test",
					version: "1.18.31",
					channel: "personal",
					architectures: ["arm64"],
					sourceCommit: "1234abcd",
					stage: "building",
					message: "Compiling",
					updatedAt: new Date().toISOString(),
				}),
			);
			const worker = join(directory, "worker.js");
			writeFileSync(
				worker,
				`const fs=require('node:fs');const path=require('node:path');const record=path.join(process.argv[2],'test.json');const job=JSON.parse(fs.readFileSync(record));if(process.argv[3]==='verified'){fs.writeFileSync(record,JSON.stringify({...job,stage:'ready',verified:true,updatedAt:new Date().toISOString()}));}process.exit(process.argv[3]==='failed'?7:0);`,
			);
			const result = spawnSync(
				process.execPath,
				[
					resolve(import.meta.dir, "report-build.ts"),
					"run",
					"--file",
					input,
					"--directory",
					records,
					"--",
					scenario === "missing"
						? "gatedspace-missing-worker.exe"
						: process.execPath,
					worker,
					records,
					scenario,
				],
				{ encoding: "utf8", timeout: 15000 },
			);
			const status = JSON.parse(
				readFileSync(join(records, "test.json"), "utf8"),
			);
			expect(status.stage).toBe(scenario === "verified" ? "ready" : "failed");
			expect(result.status).toBe(
				scenario === "verified" ? 0 : scenario === "failed" ? 7 : 1,
			);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
}
