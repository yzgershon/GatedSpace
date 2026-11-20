import { execFile, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const windowsPowerShell = () =>
	join(
		process.env.SystemRoot || "C:\\Windows",
		"System32",
		"WindowsPowerShell",
		"v1.0",
		"powershell.exe",
	);

/** A hidden, owned setup process. Cancellation also stops installer children. */
export function runSetupProcess(
	command: string,
	args: string[],
	options: { signal: AbortSignal; env?: NodeJS.ProcessEnv; timeout?: number },
): Promise<{ stdout: string; stderr: string }> {
	options.signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: tmpdir(),
			env: options.env ?? process.env,
			windowsHide: true,
			shell: false,
			stdio: "pipe",
		});
		child.stdin.end();
		let stdout = "";
		let stderr = "";
		let cancelled = false;
		let stopping: Promise<void> | undefined;
		const stop = () => {
			cancelled = true;
			if (stopping) return;
			stopping = new Promise<void>((done) => {
				if (process.platform === "win32" && child.pid) {
					execFile(
						join(
							process.env.SystemRoot || "C:\\Windows",
							"System32",
							"taskkill.exe",
						),
						["/PID", String(child.pid), "/T", "/F"],
						{ windowsHide: true, timeout: 5_000 },
						() => {
							child.kill();
							done();
						},
					);
				} else {
					child.kill();
					done();
				}
			});
		};
		const timer = setTimeout(stop, options.timeout ?? 300_000);
		options.signal.addEventListener("abort", stop, { once: true });
		if (options.signal.aborted) stop();
		child.stdout.on("data", (chunk) => {
			stdout = (stdout + chunk.toString()).slice(-64_000);
		});
		child.stderr.on("data", (chunk) => {
			stderr = (stderr + chunk.toString()).slice(-64_000);
		});
		const cleanup = () => {
			clearTimeout(timer);
			options.signal.removeEventListener("abort", stop);
		};
		child.once("error", (error) => {
			cleanup();
			reject(error);
		});
		child.once("close", async (code) => {
			cleanup();
			await stopping;
			if (cancelled)
				reject(
					new Error(
						options.signal.aborted
							? "Setup cancelled."
							: "Setup timed out. Check your connection and retry.",
					),
				);
			else if (code !== 0)
				reject(
					new Error("Setup could not finish. Check your connection and retry."),
				);
			else resolve({ stdout, stderr });
		});
	});
}
