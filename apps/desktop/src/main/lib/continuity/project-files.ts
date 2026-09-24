import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	lstat,
	mkdir,
	open,
	realpath,
	rename,
	stat,
	writeFile,
} from "node:fs/promises";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";
import { promisify } from "node:util";
import {
	excludedProjectPath,
	type PortableCheckpoint,
	safeRelativePath,
} from "@superset/shared/continuity";
import { digest } from "@superset/shared/continuity/crypto";

const execute = promisify(execFile);
const MAX_PROJECT_BYTES = 128 * 1024 * 1024;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
type Project = PortableCheckpoint["project"];

async function git(directory: string, args: string[]) {
	const result = await execute("git", ["-C", directory, ...args], {
		windowsHide: true,
		timeout: 30_000,
		maxBuffer: 8 * 1024 * 1024,
		encoding: "utf8",
	});
	return result.stdout;
}
function contained(root: string, path: string) {
	const rel = relative(root, path);
	return (
		rel !== ".." &&
		!rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
		!isAbsolute(rel)
	);
}
async function checkPath(root: string, path: string) {
	let current = root;
	for (const part of path.split("/")) {
		current = join(current, part);
		if ((await lstat(current)).isSymbolicLink())
			throw new Error(`Sync skips links and junctions: ${path}`);
	}
	if (!contained(root, await realpath(current)))
		throw new Error("A project file points outside the selected folder.");
	return current;
}
export async function collectProject(directory: string): Promise<Project> {
	const root = await realpath(directory);
	const top = await realpath(
		(await git(root, ["rev-parse", "--show-toplevel"])).trim(),
	);
	if (root.toLowerCase() !== top.toLowerCase())
		throw new Error("Choose a project's Git root folder.");
	if (
		/^(dev|users|desktop|documents|downloads)$/i.test(basename(root)) ||
		dirname(root) === root
	)
		throw new Error(
			"Choose a specific project, not a folder containing unrelated work.",
		);
	const names = [
		...new Set(
			(
				await git(root, [
					"ls-files",
					"-z",
					"--cached",
					"--others",
					"--exclude-standard",
				])
			)
				.split("\0")
				.filter(Boolean),
		),
	];
	if (names.length > 20_000)
		throw new Error("This project has too many files for a single checkpoint.");
	const files: Project["files"] = [];
	const stamps = new Map<
		string,
		{ size: number; mtimeMs: number; ino: number }
	>();
	let total = 0;
	for (const name of names) {
		if (excludedProjectPath(name)) continue;
		const path = join(root, name);
		try {
			await checkPath(root, name);
			const handle = await open(path, "r");
			try {
				const before = await handle.stat();
				if (!before.isFile()) throw new Error(`Cannot sync non-file: ${name}`);
				if (
					before.size > MAX_FILE_BYTES ||
					total + before.size > MAX_PROJECT_BYTES
				)
					throw new Error(
						"Project files exceed the checkpoint size limit. Exclude large generated files in .gitignore.",
					);
				const data = Buffer.alloc(before.size);
				let offset = 0;
				while (offset < data.length) {
					const result = await handle.read(
						data,
						offset,
						data.length - offset,
						offset,
					);
					if (!result.bytesRead) break;
					offset += result.bytesRead;
				}
				const after = await handle.stat();
				if (
					offset !== data.length ||
					before.size !== after.size ||
					before.mtimeMs !== after.mtimeMs
				)
					throw new Error(
						"Project files changed while preparing the checkpoint. Wait for the task to finish and retry.",
					);
				await checkPath(root, name);
				total += data.length;
				stamps.set(name, {
					size: after.size,
					mtimeMs: after.mtimeMs,
					ino: after.ino,
				});
				files.push({
					path: name,
					content: data.toString("base64"),
					sha256: digest(data),
					executable: (before.mode & 0o111) !== 0,
				});
			} finally {
				await handle.close();
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			// A tracked deletion is represented by its absence in this complete snapshot.
		}
	}
	const commit = await git(root, ["rev-parse", "HEAD"])
		.then((value) => value.trim())
		.catch(() => null);
	const remote = await git(root, ["remote", "get-url", "origin"])
		.then((value) => value.trim())
		.catch(() => null);
	// Recheck all files after reading the entire tree, not only each individual
	// read. A task can edit an earlier file while a later file is being copied.
	const finalNames = (
		await git(root, [
			"ls-files",
			"-z",
			"--cached",
			"--others",
			"--exclude-standard",
		])
	)
		.split("\0")
		.filter((name) => name && !excludedProjectPath(name));
	const originalNames = names.filter((name) => !excludedProjectPath(name));
	if (
		JSON.stringify([...new Set(finalNames)].sort()) !==
		JSON.stringify([...originalNames].sort())
	)
		throw new Error(
			"The project changed during export. Wait for the task to finish and retry.",
		);
	for (const name of originalNames) {
		const current = await lstat(join(root, name)).catch(
			(error: NodeJS.ErrnoException) => {
				if (error.code === "ENOENT") return null;
				throw error;
			},
		);
		const before = stamps.get(name);
		if (
			before
				? !current ||
					current.isSymbolicLink() ||
					before.size !== current.size ||
					before.mtimeMs !== current.mtimeMs ||
					before.ino !== current.ino
				: current
		)
			throw new Error(
				"The project changed during export. Wait for the task to finish and retry.",
			);
	}
	// Embedded credentials in a remote URL must never be copied to the other PC.
	const safeRemote =
		remote && !/^https?:\/\/[^/]*@/i.test(remote) ? remote : null;
	return {
		name: basename(root),
		gitRemote: safeRemote,
		gitCommit: commit,
		files,
	};
}

/** Always creates a new sibling folder. Existing work is never merged or overwritten. */
export async function restoreProject(
	parent: string,
	folderName: string,
	project: Project,
) {
	if (
		!/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(folderName) ||
		!safeRelativePath(folderName)
	)
		throw new Error("Choose a simple name for the new project folder.");
	const root = await realpath(parent);
	const target = resolve(root, folderName);
	if (!contained(root, target)) throw new Error("Invalid destination folder.");
	try {
		await stat(target);
		throw new Error(
			"That folder already exists. Choose a new name to preserve your local work.",
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const staging = `${target}.sync-${randomUUID()}`;
	await mkdir(staging, { recursive: false });
	const seen = new Set<string>();
	let total = 0;
	try {
		for (const file of project.files) {
			if (excludedProjectPath(file.path) || seen.has(file.path.toLowerCase()))
				throw new Error("Checkpoint contains an unsafe or repeated path.");
			seen.add(file.path.toLowerCase());
			const data = Buffer.from(file.content, "base64");
			total += data.length;
			if (
				data.length > MAX_FILE_BYTES ||
				total > MAX_PROJECT_BYTES ||
				data.toString("base64") !== file.content ||
				digest(data) !== file.sha256
			)
				throw new Error("Checkpoint file verification failed.");
			const path = join(staging, file.path);
			await mkdir(dirname(path), { recursive: true });
			await checkPath(
				staging,
				relative(staging, dirname(path)).replaceAll("\\", "/") || ".",
			);
			await writeFile(path, data, {
				flag: "wx",
				mode: file.executable ? 0o700 : 0o600,
			});
		}
		// A fresh Git root lets the restored working tree produce future checkpoints.
		// Do not copy source hooks, credentials, configuration, or execute a remote.
		await git(staging, ["init", "--quiet", "--template="]);
		// Another process may have created the destination while files were restored.
		try {
			await stat(target);
			throw new Error(
				"The destination appeared during restore. Your checkpoint remains in its separate staging folder.",
			);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		await rename(staging, target);
		return target;
	} catch (error) {
		// Preserve partial restore for recovery; never recursively remove user directories.
		throw new Error(
			`Restore did not finish. Existing folders were preserved. ${error instanceof Error ? error.message : "Retry in a new folder."}`,
		);
	}
}
