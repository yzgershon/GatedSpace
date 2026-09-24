import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { env } from "../env.main";
import { readPersonalReleaseDir } from "./personal-update";

type RecoveryStatus = {
	state: "ready" | "starting" | "unavailable";
	error?: string;
};
let job: Promise<void> | undefined;
let checking: Promise<RecoveryStatus> | undefined;
let status: RecoveryStatus = { state: "unavailable" };

export function recoverLocalBackend(): Promise<RecoveryStatus> {
	checking ??= checkAndRecover().finally(() => {
		checking = undefined;
	});
	return checking;
}

async function checkAndRecover(): Promise<RecoveryStatus> {
	if (
		process.platform !== "win32" ||
		env.GATEDSPACE_PERSONAL !== "1" ||
		!/^http:\/\/(localhost|127\.0\.0\.1):3001\/?$/.test(env.NEXT_PUBLIC_API_URL)
	) {
		return {
			state: "unavailable",
			error: "Automatic recovery is available for the personal local backend.",
		};
	}
	if (job) return status;
	try {
		const response = await fetch(
			`${env.NEXT_PUBLIC_API_URL}/api/health/ready`,
			{
				signal: AbortSignal.timeout(3_000),
			},
		);
		if (response.ok) return { state: "ready" };
	} catch {
		/* Start the configured local services below. */
	}
	// The personal updater already records the owner's checkout. Never execute a
	// command/path received from a renderer or a network request.
	try {
		const releaseDir = readPersonalReleaseDir();
		if (!releaseDir) throw new Error("Personal checkout is not configured.");
		const root = resolve(releaseDir, "../../..");
		if (resolve(root, "apps/desktop/release") !== resolve(releaseDir)) {
			throw new Error(
				"Personal release folder does not identify a GatedSpace checkout.",
			);
		}
		const script = join(root, "scripts/start-gatedspace-local-stack.ps1");
		if (!existsSync(script))
			throw new Error("Local services launcher was not found.");
		status = { state: "starting" };
		job = new Promise<void>((done) => {
			execFile(
				join(
					process.env.SystemRoot ?? "C:\\Windows",
					"System32/WindowsPowerShell/v1.0/powershell.exe",
				),
				[
					"-NoProfile",
					"-NonInteractive",
					"-ExecutionPolicy",
					"Bypass",
					"-File",
					script,
					"-RepoRoot",
					root,
					"-UseDockerAutoStart",
				],
				{ windowsHide: true, timeout: 15 * 60_000, maxBuffer: 256 * 1024 },
				(error) => {
					status = error
						? {
								state: "unavailable",
								error:
									"Local services could not start. See GatedSpace/logs/local-stack-launcher.log.",
							}
						: { state: "ready" };
					if (error) console.warn("[local-backend]", status.error);
					done();
				},
			);
		}).finally(() => {
			job = undefined;
		});
	} catch (error) {
		status = {
			state: "unavailable",
			error:
				error instanceof Error
					? error.message
					: "Local services could not start.",
		};
	}
	return status;
}
