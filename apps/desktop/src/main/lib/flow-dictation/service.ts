import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { FlowConnection } from "./client";

type Capture = {
	key: string;
	child?: ChildProcess;
	connection?: FlowConnection;
	timer?: ReturnType<typeof setTimeout>;
};
let capture: Capture | undefined;

export function bundledFlowDirectory() {
	return app.isPackaged
		? join(process.resourcesPath, "resources", "flow-dictation")
		: join(app.getAppPath(), "dist", "resources", "flow-dictation");
}

async function connectFlow(current: Capture) {
	const directory = bundledFlowDirectory();
	const executable = join(directory, "GatedSpace.Flow.exe");
	if (
		!existsSync(executable) ||
		!existsSync(join(directory, "ggml-base.en-q5_1.bin"))
	)
		throw new Error(
			"Built-in dictation files are missing. Reinstall GatedSpace to restore voice typing.",
		);
	// A private helper belongs to this capture. No global Flow app or clipboard.
	const pipe = `GatedSpace.Flow.${process.pid}.${randomUUID()}`;
	const child = spawn(executable, ["--pipe", pipe], {
		cwd: directory,
		windowsHide: true,
		stdio: ["pipe", "ignore", "pipe"],
	});
	current.child = child;
	let failure = "";
	child.stderr?.on("data", (data: Buffer) => {
		failure = (failure + data.toString()).slice(-2000);
	});
	child.on("error", (error) => {
		failure = error.message;
	});
	child.stdin?.on("error", () => {});
	for (let attempt = 0; attempt < 100; attempt++) {
		if (capture !== current) throw new Error("Dictation was cancelled.");
		if (child.exitCode !== null || child.signalCode !== null)
			throw new Error(
				"Built-in dictation could not start. " +
					(failure || "Try the microphone again."),
			);
		try {
			return await FlowConnection.open(`\\\\.\\pipe\\${pipe}`);
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
	throw new Error(`Built-in dictation did not start. ${failure}`);
}
export async function startFlow(key: string) {
	if (process.platform !== "win32")
		throw new Error("Flow dictation is available on Windows.");
	if (capture) throw new Error("Finish dictation in the other composer first.");
	const current: Capture = { key };
	capture = current;
	try {
		const connection = await connectFlow(current);
		if (capture !== current) {
			connection.close();
			throw new Error("Dictation was cancelled.");
		}
		current.connection = connection;
		const status = await connection.request("status", 60_000);
		if (status.protocol !== 1 || status.state !== "ready")
			throw new Error("Built-in dictation is not ready. Try again.");
		if (capture !== current) throw new Error("Dictation was cancelled.");
		await connection.request("start");
		current.timer = setTimeout(() => cancelFlow(key), 4 * 60_000);
		return { recording: true };
	} catch (error) {
		if (capture === current) cancelFlow(key);
		throw error;
	}
}
export async function stopFlow(key: string) {
	const current = capture;
	if (!current || current.key !== key || !current.connection)
		throw new Error("No active dictation for this composer.");
	clearTimeout(current.timer);
	try {
		return {
			text: (await current.connection.request("stop", 120_000)).text ?? "",
		};
	} finally {
		if (capture === current) cancelFlow(key);
	}
}
export function cancelFlow(key: string) {
	if (capture?.key !== key) return;
	const current = capture;
	capture = undefined;
	clearTimeout(current.timer);
	current.connection?.close();
	current.child?.stdin?.end();
	current.child?.kill(); // Cancels startup/inference without touching standalone Flow.
}
app.once("before-quit", () => {
	if (capture) cancelFlow(capture.key);
});
