/** Run through report-build.ts run. This worker never installs or publishes. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	closeSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	realpathSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
	buildStatusDirectory,
	writeBuildJob,
} from "../../apps/desktop/src/main/lib/build-status/store";
import {
	findPersonalUpdate,
	readPersonalReleaseDir,
} from "../../apps/desktop/src/main/lib/personal-update";
import {
	type BuildJob,
	buildJobSchema,
} from "../../apps/desktop/src/shared/build-status";
import { BuildCheckpoints, hashFiles } from "./build-checkpoints";

const { values } = parseArgs({
	options: {
		repo: { type: "string" },
		primary: { type: "string" },
		job: { type: "string" },
	},
});
assert.ok(
	values.repo && values.primary && values.job,
	"Expected --repo, --primary and --job",
);
const repo = realpathSync(resolve(values.repo));
const primary = realpathSync(resolve(values.primary));
assert.ok(
	repo !== primary && relative(primary, repo).startsWith(".."),
	"Use an isolated checkout outside the watched workspace",
);
const desktop = join(repo, "apps/desktop");
const jobFile = resolve(values.job);
const jobDirectory = dirname(jobFile);
let job = buildJobSchema.parse(
	JSON.parse(readFileSync(jobFile, "utf8").replace(/^\uFEFF/, "")),
);
assert.equal(job.channel, "personal");
assert.deepEqual(job.architectures, ["arm64"]);
assert.equal(
	process.arch,
	"arm64",
	"Personal worker requires the native ARM64 runtime",
);
const started = Date.now();
const steps = new BuildCheckpoints(
	join(dirname(repo), "personal-checkpoints.json"),
);
const environment = Object.fromEntries(
	Object.entries(process.env).map(([key, value]) => [key.toUpperCase(), value]),
);
for (const name of [
	"ELECTRON_RUN_AS_NODE",
	"NODEFAULTCURRENTDIRECTORYINEXEPATH",
	"NEXT_PUBLIC_LOCAL_ONLY",
	"CONTROLS_STYLE_DIR",
	"TARGET_ARCH",
])
	delete environment[name];
environment.GATEDSPACE_PERSONAL = "1";
environment.CSC_IDENTITY_AUTO_DISCOVERY = "false";
environment.PATH = `${dirname(process.execPath)};${environment.PATH ?? ""}`;
environment.GIT_CONFIG_COUNT = "1";
environment.GIT_CONFIG_KEY_0 = "safe.directory";
environment.GIT_CONFIG_VALUE_0 = repo;
const git = (...args: string[]) =>
	execFileSync("git", args, {
		cwd: repo,
		env: environment,
		encoding: "utf8",
		windowsHide: true,
	}).trim();
const sourceUnchanged = () => {
	assert.equal(
		git("rev-parse", "HEAD"),
		job.sourceCommit,
		"Build snapshot commit changed",
	);
	assert.equal(
		git("status", "--porcelain", "--untracked-files=no"),
		"",
		"Build snapshot has uncommitted changes",
	);
};
function report(stage: BuildJob["stage"], message: string, verified = false) {
	job = {
		...job,
		stage,
		message,
		verified,
		updatedAt: new Date().toISOString(),
	};
	writeFileSync(jobFile, JSON.stringify(job, null, 2));
	writeBuildJob(buildStatusDirectory(), job);
	console.log(`${job.updatedAt} ${stage}: ${message}`);
}
async function command(
	name: string,
	executable: string,
	args: string[],
	cwd = desktop,
	extra: Record<string, string> = {},
) {
	const log = join(jobDirectory, `${name}.log`);
	const fd = openSync(log, "a");
	try {
		const child = spawn(executable, args, {
			cwd,
			env: { ...environment, ...extra },
			stdio: ["ignore", fd, fd],
			windowsHide: true,
		});
		const code = await new Promise<number>((resolve, reject) => {
			child.once("error", reject);
			child.once("exit", (code) => resolve(code ?? 1));
		});
		assert.equal(
			code,
			0,
			`${name} failed (exit ${code}). See ${log}. Resume this job after correcting the failed step.`,
		);
	} finally {
		closeSync(fd);
	}
}
const bun = (name: string, args: string[], cwd = desktop) =>
	command(name, process.execPath, args, cwd);

// A separate worker cannot package or replace the same output at the same time.
const lock = join(dirname(repo), "personal-worker.lock");
function acquireLock() {
	if (existsSync(lock)) {
		const pid = Number(readFileSync(lock, "utf8"));
		assert.ok(
			Number.isInteger(pid) && pid > 0,
			"Invalid build lock; inspect it before retrying",
		);
		let alive = true;
		try {
			process.kill(pid, 0);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false;
		}
		assert.ok(!alive, `Another installer worker is running (PID ${pid})`);
		unlinkSync(lock);
	}
	writeFileSync(lock, String(process.pid), { flag: "wx" });
}
async function phase(
	name: string,
	input: string,
	outputs: string[],
	action: () => Promise<void>,
	verifying = false,
) {
	sourceUnchanged();
	report(verifying ? "verifying" : "building", name);
	return steps.run(name, input, outputs, action);
}
let locked = false;
try {
	acquireLock();
	locked = true;
	sourceUnchanged();
	assert.equal(
		JSON.parse(readFileSync(join(desktop, "package.json"), "utf8")).version,
		job.version,
	);
	const destination = join(primary, "apps/desktop/release");
	mkdirSync(destination, { recursive: true });
	assert.equal(
		realpathSync(readPersonalReleaseDir() ?? ""),
		realpathSync(destination),
		"Personal updater must point to the primary release directory",
	);
	await phase(
		"Dependencies",
		await hashFiles([
			join(repo, "bun.lock"),
			join(repo, "scripts/vendor-native-win-arm64.ts"),
			join(desktop, "runtime-dependencies.ts"),
		]),
		[join(repo, "node_modules/.personal-native-ready")],
		async () => {
			await bun(
				"dependencies",
				["install", "--frozen-lockfile", "--ignore-scripts"],
				repo,
			);
			await bun("native-vendor", ["scripts/vendor-native-win-arm64.ts"], repo);
			await bun("native-install", ["run", "install:deps"]);
			writeFileSync(
				join(repo, "node_modules/.personal-native-ready"),
				`${process.arch}:${job.sourceCommit}`,
			);
		},
	);
	// Exclude only documentation/tests/verification harnesses from app compilation identity.
	// A verifier-only repair can reuse byte-identical app output across commits.
	const inputs = git("ls-files", "-z")
		.split("\0")
		.filter(
			(path) =>
				path &&
				(path.startsWith("apps/desktop/") ||
					path.startsWith("packages/") ||
					path.startsWith("tooling/") ||
					path === "bun.lock" ||
					path === "package.json") &&
				!/(^|\/)(scripts|plans|docs|__tests__)(\/|$)|\.(test|spec)\./.test(
					path,
				),
		);
	// Native and CLI preparation scripts are real build inputs.
	inputs.push(
		...git("ls-files", "-z", "apps/desktop/scripts", "packages/cli/scripts")
			.split("\0")
			.filter((p) =>
				/(?:build-|copy-native|validate-native|strip-dist|generate-file|check-pty)/.test(
					p,
				),
			),
	);
	const buildPaths = [...new Set(inputs)].sort();
	const envFiles = [
		".env",
		".env.local",
		".env.production",
		".env.production.local",
	]
		.flatMap((name) => [join(repo, name), join(desktop, name)])
		.filter(existsSync);
	const compileInput = createHash("sha256")
		.update(
			JSON.stringify({
				paths: buildPaths,
				bun: Bun.version,
				architecture: process.arch,
				env: Object.fromEntries(
					Object.entries(environment)
						.filter(([name]) =>
							/^(NEXT_PUBLIC_|VITE_|GATEDSPACE_|NODE_ENV)/.test(name),
						)
						.sort(),
				),
				files: await hashFiles(buildPaths.map((path) => join(repo, path))),
				config: await hashFiles(envFiles),
			}),
		)
		.digest("hex");
	const dist = join(desktop, "dist");
	const compiled = await phase(
		"Compile app",
		compileInput,
		[dist],
		async () => {
			// Explicit prebuild once; invoking `bun run build` here would run its prehook again.
			await bun("compile", ["run", "prebuild"]);
			await bun("strip-sourcemaps", [
				"run",
				"scripts/strip-dist-sourcemaps.ts",
			]);
		},
	);
	// prebuild validated native dependencies and source maps before stripping.
	// The compile checkpoint attests that successful sequence; maps no longer ship.
	await bun("bundle-preflight", ["run", "validate:personal-bundle"]);
	for (const [name, script, flag, result] of [
		[
			"Session notifications",
			"check-notifications.mjs",
			"NOTIFICATION_PACKAGED",
			"notification-preview/results.json",
		],
		[
			"Build indicator",
			"check-build-status.mjs",
			"BUILD_STATUS_PACKAGED",
			"build-status-preview/results.json",
		],
		[
			"Queue and collections",
			"check-collections.mjs",
			"COLLECTIONS_PACKAGED",
			"collections-preview/results.json",
		],
		[
			"Tabs and questions",
			"preview-session-controls.mjs",
			"CONTROLS_PACKAGED",
			"session-controls-preview/results.json",
		],
	] as const) {
		await phase(
			name,
			`${job.sourceCommit}:${compiled}`,
			[join(repo, ".tmp", result)],
			() =>
				command(name, "node", [`scripts/${script}`], desktop, { [flag]: "1" }),
			true,
		);
	}
	await phase(
		"Project organizer",
		`${job.sourceCommit}:${compiled}`,
		[join(repo, ".tmp/session-organizer-preview/results.json")],
		() =>
			command("organizer", "node", [
				"scripts/check-organizer-release.mjs",
				repo,
			]),
		true,
	);
	const release = join(desktop, "release");
	const filename = `GatedSpace-personal-${job.version}-arm64.exe`;
	const artifacts = [filename, `${filename}.blockmap`, "latest.yml"];
	const packagerEntry = join(repo, "scripts/release/windows-packager.cjs");
	const packaged = await phase(
		"Package ARM64 installer",
		`${compiled}:${compileInput}:${await hashFiles([packagerEntry])}`,
		artifacts.map((name) => join(release, name)),
		async () => {
			// The exact ARM64 native files were prepared and validated above. Do not rebuild
			// them a second time during packaging (or mutate shared native dependencies).
			await command("packaging", "node", [
				packagerEntry,
				"--publish",
				"never",
				"--config.npmRebuild=false",
			]);
		},
	);
	// Always verify the actual installer, even on a resumed job. Never trust a stale receipt.
	await phase(
		"Verify packaged files",
		`${packaged}:${job.sourceCommit}`,
		[],
		async () => {
			await bun(
				"verification",
				[
					"scripts/release/verify-personal-installer.ts",
					"--repo",
					repo,
					"--job",
					jobFile,
					"--receipt",
					join(jobDirectory, "receipt.json"),
				],
				repo,
			);
		},
		true,
	);
	const receipt = JSON.parse(
		readFileSync(join(jobDirectory, "receipt.json"), "utf8"),
	);
	assert.ok(
		receipt.ok &&
			receipt.sourceCommit === job.sourceCommit &&
			receipt.version === job.version,
	);
	sourceUnchanged();
	report("verifying", "Checking copied installer and Update discovery.");
	// Publish blockmap last: the updater only discovers a completed pair.
	for (const name of [filename, "latest.yml", `${filename}.blockmap`]) {
		const from = join(release, name),
			pending = join(destination, `${name}.pending`);
		copyFileSync(from, pending);
		assert.equal(
			await hashFiles([from]),
			await hashFiles([pending]),
			`Copied file differs: ${name}`,
		);
		renameSync(pending, join(destination, name));
	}
	assert.equal(
		findPersonalUpdate("0.0.0", destination, "arm64")?.version,
		job.version,
	);
	assert.equal(findPersonalUpdate(job.version, destination, "arm64"), null);
	writeFileSync(
		join(jobDirectory, "discovery.json"),
		JSON.stringify({
			ok: true,
			version: job.version,
			releaseDir: destination,
			installerExecuted: false,
		}),
	);
	report(
		"ready",
		"Personal ARM64 installer verified. Ready through Update.",
		true,
	);
} catch (error) {
	report(
		"failed",
		(error instanceof Error ? error.message : String(error)).slice(0, 500),
	);
	process.exitCode = 1;
} finally {
	writeFileSync(
		join(jobDirectory, "timings.json"),
		JSON.stringify(
			{
				elapsedMs: Date.now() - started,
				timingBasis: "Wall clock for this attempt, including system sleep",
				sourceCommit: job.sourceCommit,
				phases: steps.timings,
			},
			null,
			2,
		),
	);
	if (locked) unlinkSync(lock);
	// Notification failure must not turn a verified installer into a failed build.
	try {
		await command(
			"notification",
			"powershell.exe",
			[
				"-NoProfile",
				"-File",
				join(repo, "scripts/release/notify-personal-build.ps1"),
				"-Version",
				job.version,
				"-Stage",
				job.stage,
			],
			repo,
		);
	} catch (error) {
		console.error(
			"Windows notification unavailable; persistent status remains.",
			String(error),
		);
	}
}
