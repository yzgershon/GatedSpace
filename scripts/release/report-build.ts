/** Durable installer notifications. See docs/RELEASING.md for the worker contract. */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
	buildStatusDirectory,
	heartbeatBuild,
	writeBuildJob,
} from "../../apps/desktop/src/main/lib/build-status/store";
import { buildJobSchema } from "../../apps/desktop/src/shared/build-status";

const { values, positionals } = parseArgs({
	args: process.argv.slice(2),
	allowPositionals: true,
	options: { file: { type: "string" }, directory: { type: "string" } },
});
const directory = values.directory ?? buildStatusDirectory();
if (!values.file)
	throw new Error(
		"Expected --file with a build job JSON. Use run before the worker command, or report to update its phase.",
	);
const job = buildJobSchema.parse(
	JSON.parse(readFileSync(values.file, "utf8").replace(/^\uFEFF/, "")),
);
if (positionals[0] !== "run" && positionals[0] !== "report")
	throw new Error("Expected run or report");
writeBuildJob(directory, job);
if (positionals[0] === "run") {
	const [command, ...args] = positionals.slice(1);
	if (!command || job.stage !== "building")
		throw new Error("Run requires a command and a building job");
	heartbeatBuild(directory, job.id);
	const timer = setInterval(() => heartbeatBuild(directory, job.id), 30_000);
	const child = spawn(command, args, { stdio: "inherit", windowsHide: true });
	const result = await new Promise<{ code: number; error?: string }>(
		(resolve) => {
			child.once("error", (error) =>
				resolve({ code: 1, error: error.message }),
			);
			child.once("exit", (code) => resolve({ code: code ?? 1 }));
		},
	);
	clearInterval(timer);
	const latest = buildJobSchema.parse(
		JSON.parse(readFileSync(join(directory, `${job.id}.json`), "utf8")),
	);
	if (result.code !== 0 || latest.stage !== "ready") {
		writeBuildJob(directory, {
			...latest,
			stage: "failed",
			updatedAt: new Date().toISOString(),
			message:
				latest.stage === "failed"
					? latest.message
					: (result.error ??
						(result.code
							? `Build worker exited with code ${result.code}. Check the build log.`
							: "Worker finished without confirming installer verification.")),
		});
		process.exitCode = result.code || 1;
	}
}
