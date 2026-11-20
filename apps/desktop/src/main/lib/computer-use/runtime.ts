import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, open, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { runSetupProcess, windowsPowerShell } from "../setup-process";

// Official immutable release; hashes from astral-sh/uv release asset digests.
export const COMPUTER_UV_VERSION = "0.13.9";
export const COMPUTER_UV_ASSETS = {
	x64: {
		target: "x86_64",
		sha256: "edd61f7f5728a56cc62455386661860bdfc7bab65872f39b0c25bdcc1d8e1beb",
	},
	arm64: {
		target: "aarch64",
		sha256: "72eed595983a4d7d22d79f21065b0f4479cc7e5c7a89104bb410c8f47559a878",
	},
} as const;

export function findComputerRunner() {
	return [
		...(process.env.PATH ?? "").split(delimiter),
		join(homedir(), ".local", "bin"),
	]
		.filter(Boolean)
		.map((dir) => join(dir, "uvx.exe"))
		.find(existsSync);
}

export function verifyRuntimeArchive(bytes: Uint8Array, expected: string) {
	if (createHash("sha256").update(bytes).digest("hex") !== expected)
		throw new Error(
			"Computer control download could not be verified. Retry setup.",
		);
}

async function runtimeReady(directory: string) {
	for (const name of ["uv.exe", "uvx.exe"]) {
		try {
			const file = await open(join(directory, name), "r");
			try {
				const header = Buffer.alloc(2);
				await file.read(header, 0, 2, 0);
				if (header.toString("ascii") !== "MZ") return false;
			} finally {
				await file.close();
			}
		} catch {
			return false;
		}
	}
	return true;
}

/** Both directories are inside the private runtime root, never user CLI paths. */
export async function publishRuntimeDirectory(
	unpacked: string,
	destination: string,
) {
	if (!(await runtimeReady(unpacked)))
		throw new Error("Computer control runtime is incomplete. Retry setup.");
	if (await runtimeReady(destination)) return;
	if (existsSync(destination)) {
		// Quarantine a partial prior install inside this attempt's staging folder.
		await rename(destination, join(dirname(unpacked), "incomplete"));
	}
	try {
		await rename(unpacked, destination);
	} catch (error) {
		// Another app instance may have completed the same install.
		if (!(await runtimeReady(destination))) throw error;
	}
}

async function download(url: string, signal: AbortSignal) {
	const response = await fetch(url, {
		signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
	});
	if (!response.ok || !response.body)
		throw new Error(
			"Computer control download failed. Check your connection and retry.",
		);
	const reader = response.body.getReader();
	const parts: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.length;
			if (size > 50_000_000)
				throw new Error("Unexpected computer control download size.");
			parts.push(value);
		}
	} finally {
		await reader.cancel().catch(() => {});
	}
	return Buffer.concat(parts);
}

export async function ensureComputerRunner(
	signal: AbortSignal,
	progress: (message: string) => void = () => {},
	options: {
		root?: string;
		arch?: string;
		platform?: string;
		find?: () => string | undefined;
		download?: typeof download;
		run?: typeof runSetupProcess;
	} = {},
) {
	signal.throwIfAborted();
	if ((options.platform ?? process.platform) !== "win32")
		throw new Error("Computer control is currently available on Windows.");
	const existing = (options.find ?? findComputerRunner)();
	if (existing) return existing;
	const arch = options.arch ?? process.arch;
	if (arch !== "x64" && arch !== "arm64")
		throw new Error("Computer control requires Windows x64 or ARM64.");
	const asset = COMPUTER_UV_ASSETS[arch];
	const root =
		options.root ?? join(homedir(), ".superset", "runtime", "computer-control");
	const destination = join(root, `uv-${COMPUTER_UV_VERSION}-${arch}`);
	const runner = join(destination, "uvx.exe");
	if (await runtimeReady(destination)) return runner;
	progress("Downloading computer control runtime…");
	const bytes = await (options.download ?? download)(
		`https://github.com/astral-sh/uv/releases/download/${COMPUTER_UV_VERSION}/uv-${asset.target}-pc-windows-msvc.zip`,
		signal,
	);
	signal.throwIfAborted();
	verifyRuntimeArchive(bytes, asset.sha256);
	await mkdir(root, { recursive: true });
	const staging = await mkdtemp(join(root, ".setup-"));
	try {
		const archive = join(staging, "runtime.zip");
		const unpacked = join(staging, "unpacked");
		await writeFile(archive, bytes);
		progress("Installing computer control runtime…");
		await (options.run ?? runSetupProcess)(
			windowsPowerShell(),
			[
				"-NoLogo",
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				"$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath $env:GATEDSPACE_SETUP_ARCHIVE -DestinationPath $env:GATEDSPACE_SETUP_DESTINATION",
			],
			{
				signal,
				env: {
					...process.env,
					GATEDSPACE_SETUP_ARCHIVE: archive,
					GATEDSPACE_SETUP_DESTINATION: unpacked,
				},
			},
		);
		signal.throwIfAborted();
		await publishRuntimeDirectory(unpacked, destination);
		return runner;
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}
