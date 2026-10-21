import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { FlowConnection } from "./client";

type Capture = {
	key: string;
	connection?: FlowConnection;
	timer?: ReturnType<typeof setTimeout>;
};
let capture: Capture | undefined;

async function connectFlow() {
	try {
		return await FlowConnection.open();
	} catch {
		/* Launch only after the user clicks the mic. */
	}
	const processes = await promisify(execFile)(
		"tasklist.exe",
		["/FO", "CSV", "/NH"],
		{ windowsHide: true, timeout: 5000 },
	);
	if (/"(?:Flow|GatedVoice)\.exe"/i.test(processes.stdout))
		throw new Error(
			"An older copy of Flow is running without the composer connection. Quit Flow once, then try again.",
		);
	const candidates = [
		process.env.FLOW_APP_EXE,
		"C:/Dev/Flow/dist/Flow.exe",
		join(process.env.LOCALAPPDATA ?? "", "Programs/Flow/Flow.exe"),
	];
	const executable = candidates.find((path) => path && existsSync(path));
	if (!executable)
		throw new Error(
			"Flow was not found. Install Flow or set FLOW_APP_EXE to its executable.",
		);
	const child = spawn(executable, [], {
		detached: true,
		stdio: "ignore",
		windowsHide: true,
	});
	let launchError: Error | undefined;
	child.on("error", (error) => {
		launchError = error;
	});
	child.unref();
	for (let attempt = 0; attempt < 20; attempt++) {
		if (launchError) throw launchError;
		await new Promise((resolve) => setTimeout(resolve, 500));
		try {
			return await FlowConnection.open();
		} catch {
			/* app startup */
		}
	}
	throw new Error(
		"Flow could not connect. Quit an older running copy of Flow, then try the microphone again.",
	);
}

export async function startFlow(key: string) {
	if (process.platform !== "win32")
		throw new Error("Flow dictation is available on Windows.");
	if (capture) throw new Error("Finish dictation in the other composer first.");
	const current: Capture = { key };
	capture = current;
	try {
		const connection = await connectFlow();
		if (capture !== current) {
			connection.close();
			throw new Error("Dictation was cancelled.");
		}
		current.connection = connection;
		for (let attempt = 0; attempt < 60; attempt++) {
			const status = await connection.request("status");
			if (status.protocol !== 1)
				throw new Error(
					"This Flow version needs the composer integration update.",
				);
			if (status.state !== "loading") break;
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
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
		throw new Error("No active Flow dictation for this composer.");
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
	clearTimeout(capture.timer);
	capture.connection?.close(); // Flow discards this connection's recording on disconnect.
	capture = undefined;
}
