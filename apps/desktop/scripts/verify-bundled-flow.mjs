// Real native helper + Node transport. Never starts the microphone.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { join, resolve } from "node:path";
import { FlowConnection } from "../src/main/lib/flow-dictation/client.ts";

const directory = resolve(process.argv[2] ?? "dist/resources/flow-dictation");
const executable = join(directory, "GatedSpace.Flow.exe");
async function launch() {
	const pipe = `GatedSpace.Flow.test.${randomUUID()}`;
	const child = spawn(executable, ["--pipe", pipe], {
		windowsHide: true,
		stdio: ["pipe", "ignore", "pipe"],
		env: {
			...process.env,
			DOTNET_ROOT: "C:\\no-system-dotnet",
			DOTNET_MULTILEVEL_LOOKUP: "0",
		},
	});
	const exited = once(child, "exit");
	let error = "";
	child.stderr.on("data", (chunk) => {
		error += chunk;
	});
	for (let i = 0; i < 50; i++) {
		try {
			return {
				child,
				exited,
				connection: await FlowConnection.open(`\\\\.\\pipe\\${pipe}`),
			};
		} catch {
			if (child.exitCode !== null) throw new Error(error || "Helper exited");
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
	child.kill();
	throw new Error("Helper did not connect");
}

for (const close of ["disconnect", "parent-exit"]) {
	const { child, exited, connection } = await launch();
	try {
		assert.deepEqual(await connection.request("status", 30_000), {
			state: "ready",
			protocol: 1,
		});
		const modules = JSON.parse(
			execFileSync(
				"powershell.exe",
				[
					"-NoProfile",
					"-NonInteractive",
					"-Command",
					`(Get-Process -Id ${child.pid}).Modules | Where-Object { $_.ModuleName -in @('msvcp140.dll','vcomp140.dll','vcruntime140.dll') } | Select-Object ModuleName,FileName | ConvertTo-Json`,
				],
				{ encoding: "utf8", windowsHide: true },
			),
		);
		assert.ok(Array.isArray(modules) && modules.length >= 2);
		for (const module of modules)
			assert.equal(
				resolve(module.FileName).toLowerCase(),
				join(directory, module.ModuleName).toLowerCase(),
				"VC runtime must load from the bundle, not the host computer",
			);
		await assert.rejects(connection.request("stop"), /No active microphone/);
		assert.equal((await connection.request("cancel")).state, "ready");
		assert.equal((await connection.request("status")).state, "ready");
		if (close === "disconnect") connection.close();
		else child.stdin.end();
		const timeout = setTimeout(() => child.kill(), 5000);
		const [code] = await exited;
		clearTimeout(timeout);
		assert.equal(code, 0, "Helper exits cleanly after ownership ends");
	} finally {
		connection.close();
		child.kill();
	}
}
if (process.argv[3]) {
	const result = JSON.parse(
		execFileSync(executable, ["--transcribe", resolve(process.argv[3])], {
			encoding: "utf8",
			windowsHide: true,
			timeout: 60_000,
		}),
	);
	assert.match(result.text, /what your country can do for you/i);
	console.log(
		"PASS: real offline transcription of the public JFK audio fixture.",
	);
}
console.log(
	"PASS: self-contained helper readiness, protocol, errors, disconnect and parent-exit cleanup. Microphone was not activated.",
);
