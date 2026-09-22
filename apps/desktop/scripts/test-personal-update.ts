/** Real Windows updater handoff; never installs or closes the user's app. */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
	encodePowerShell,
	installPersonalUpdate,
	personalUpdateWorker,
} from "../src/main/lib/personal-update.ts";

if (process.argv[2] === "--handoff-child") {
	const target = process.argv[3];
	assert.ok(target);
	await installPersonalUpdate(target, () => process.exit(0), {
		logPath: process.argv[4],
	});
} else {
	const root = resolve(
		import.meta.dirname,
		"../../../.tmp/personal-update-test",
	);
	await mkdir(root, { recursive: true });
	const output = await mkdtemp(join(root, "attempt-"));
	const dir = join(output, "Owner's folder & spaces");
	await mkdir(dir);
	const installer = join(dir, "fake installer.exe");
	const source = join(dir, "installer.cs");
	await writeFile(
		source,
		`using System; using System.IO;
class Installer { static int Main(string[] args) {
File.WriteAllLines(Environment.GetEnvironmentVariable("GS_TEST_UPDATE_RECEIPT"), args);
return int.Parse(Environment.GetEnvironmentVariable("GS_TEST_UPDATE_EXIT") ?? "0");
} }`,
	);
	const powershell = join(
		process.env.SystemRoot ?? "C:\\Windows",
		"System32/WindowsPowerShell/v1.0/powershell.exe",
	);
	const ps = (s: string) => `'${s.replaceAll("'", "''")}'`;
	await promisify(execFile)(
		powershell,
		[
			"-NoProfile",
			"-NonInteractive",
			"-EncodedCommand",
			encodePowerShell(
				`$ErrorActionPreference='Stop'; Add-Type -Path ${ps(source)} -OutputAssembly ${ps(installer)} -OutputType ConsoleApplication`,
			),
		],
		{ windowsHide: true },
	);
	const receipt = join(output, "receipt.txt");
	const log = join(output, "handoff.log");
	const waitForText = async (file: string, text: string) => {
		const until = Date.now() + 20_000;
		while (Date.now() < until) {
			try {
				if ((await readFile(file, "utf8")).includes(text)) return;
			} catch {}
			await new Promise((done) => setTimeout(done, 100));
		}
		throw Error(`Timed out waiting for ${text} in ${file}`);
	};
	const child = spawn(
		process.execPath,
		[import.meta.filename, "--handoff-child", installer, log],
		{
			windowsHide: true,
			env: { ...process.env, GS_TEST_UPDATE_RECEIPT: receipt },
		},
	);
	let stderr = "";
	child.stderr.on("data", (data) => {
		stderr += data;
	});
	const code = await new Promise<number | null>((done, fail) => {
		child.on("exit", done);
		child.on("error", fail);
	});
	assert.equal(code, 0, stderr);
	await waitForText(log, "Installation completed successfully.");
	assert.deepEqual((await readFile(receipt, "utf8")).trim().split(/\r?\n/), [
		"/S",
		"--force-run",
	]);

	// A still-running parent cancels at a real time deadline, without starting anything.
	const timeoutLog = join(output, "timeout.log");
	const timeoutReceipt = join(output, "must-not-run.txt");
	const worker = personalUpdateWorker({
		installerPath: installer,
		parentPid: process.pid,
		readyPath: join(output, "timeout-ready"),
		logPath: timeoutLog,
		timeoutSeconds: 1,
	});
	await assert.rejects(
		promisify(execFile)(
			powershell,
			[
				"-NoProfile",
				"-NonInteractive",
				"-EncodedCommand",
				encodePowerShell(worker),
			],
			{
				windowsHide: true,
				env: { ...process.env, GS_TEST_UPDATE_RECEIPT: timeoutReceipt },
			},
		),
	);
	await waitForText(timeoutLog, "GatedSpace did not close");
	await assert.rejects(readFile(timeoutReceipt));

	const failureLog = join(output, "failure.log");
	assert.ok(child.pid);
	const failure = personalUpdateWorker({
		installerPath: installer,
		parentPid: child.pid,
		readyPath: join(output, "failure-ready"),
		logPath: failureLog,
	});
	await assert.rejects(
		promisify(execFile)(
			powershell,
			[
				"-NoProfile",
				"-NonInteractive",
				"-EncodedCommand",
				encodePowerShell(failure),
			],
			{
				windowsHide: true,
				env: {
					...process.env,
					GS_TEST_UPDATE_RECEIPT: receipt,
					GS_TEST_UPDATE_EXIT: "17",
				},
			},
		),
	);
	await waitForText(failureLog, "Installer exited with code 17");
	const checks = [
		"independent waiter survives parent exit",
		"installer receives silent and relaunch flags",
		"paths with spaces, apostrophes and ampersands",
		"live parent timeout prevents install",
		"installer failure logged",
	];
	await writeFile(
		join(root, "results.json"),
		JSON.stringify({ ok: true, checks, output }, null, 2),
	);
	console.log(JSON.stringify({ ok: true, checks, output }));
}
