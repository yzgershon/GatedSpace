import {
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	statSync,
	watch,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	type BuildJob,
	buildIdSchema,
	buildJobSchema,
	buildRevision,
	isBuildActive,
} from "../../../shared/build-status";

export const buildStatusDirectory = () =>
	join(homedir(), ".superset", "build-status");
const MAX_BYTES = 16_384;
const STALE_MS = 120_000;

function readSmallFile(path: string): string {
	if (statSync(path).size > MAX_BYTES)
		throw new Error("Build status file is too large");
	return readFileSync(path, "utf8").replace(/^\uFEFF/, "");
}

export function writeBuildJob(directory: string, value: unknown): BuildJob {
	const job = buildJobSchema.parse(value);
	mkdirSync(directory, { recursive: true });
	const path = join(directory, `${job.id}.json`);
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, JSON.stringify(job));
	renameSync(temporary, path);
	return job;
}

export function heartbeatBuild(directory: string, id: string) {
	buildIdSchema.parse(id);
	mkdirSync(directory, { recursive: true });
	writeFileSync(join(directory, `${id}.heartbeat`), String(Date.now()));
}

export function readBuildJobs(directory: string, now = Date.now()): BuildJob[] {
	try {
		const jobs: BuildJob[] = [];
		for (const name of readdirSync(directory)) {
			if (
				!name.endsWith(".json") ||
				!buildIdSchema.safeParse(name.slice(0, -5)).success
			)
				continue;
			try {
				const job = buildJobSchema.parse(
					JSON.parse(readSmallFile(join(directory, name))),
				);
				if (name !== `${job.id}.json`) continue;
				if (isBuildActive(job)) {
					let heartbeat = Date.parse(job.updatedAt);
					try {
						heartbeat = Math.max(
							heartbeat,
							statSync(join(directory, `${job.id}.heartbeat`)).mtimeMs,
						);
					} catch {
						/* No worker heartbeat yet. */
					}
					if (now - heartbeat > STALE_MS) {
						job.stage = "failed";
						job.message =
							"Build updates stopped. The worker may have exited or this PC restarted. Check the build before retrying.";
					}
				}
				let dismissed = false;
				try {
					dismissed =
						readSmallFile(join(directory, `${job.id}.ack`)) ===
						buildRevision(job);
				} catch {
					/* Not dismissed. */
				}
				if (!dismissed || isBuildActive(job)) jobs.push(job);
			} catch {
				/* Ignore unrelated, incomplete or invalid local files. */
			}
		}
		return jobs
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
			.slice(0, 32);
	} catch {
		return [];
	}
}

export function dismissBuild(directory: string, id: string, revision: string) {
	buildIdSchema.parse(id);
	const current = readBuildJobs(directory).find((job) => job.id === id);
	if (!current || isBuildActive(current) || buildRevision(current) !== revision)
		return;
	writeFileSync(join(directory, `${id}.ack`), revision);
}

/** One small local directory, no repository scanning or network polling. */
export function observeBuildJobs(
	directory: string,
	emit: (jobs: BuildJob[]) => void,
) {
	mkdirSync(directory, { recursive: true });
	let previous = "";
	let debounce: ReturnType<typeof setTimeout> | undefined;
	let staleTimer: ReturnType<typeof setInterval> | undefined;
	let watchFailed = false;
	const refresh = () => {
		const jobs = readBuildJobs(directory);
		const serialized = JSON.stringify(jobs);
		if (serialized !== previous) {
			previous = serialized;
			emit(jobs);
		}
		if ((watchFailed || jobs.some(isBuildActive)) && !staleTimer)
			staleTimer = setInterval(refresh, 30_000);
		else if (!watchFailed && !jobs.some(isBuildActive) && staleTimer) {
			clearInterval(staleTimer);
			staleTimer = undefined;
		}
	};
	const watcher = watch(directory, () => {
		if (debounce) clearTimeout(debounce);
		debounce = setTimeout(refresh, 80);
	});
	watcher.on("error", () => {
		watchFailed = true;
		if (!staleTimer) staleTimer = setInterval(refresh, 30_000);
	});
	refresh();
	return () => {
		watcher.close();
		clearTimeout(debounce);
		clearInterval(staleTimer);
	};
}
