import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { hashFiles } from "./build-checkpoints";

/** Release numbers change every ship; dependency contents do not. */
export function dependencyIdentity(
	lockText: string,
	bunVersion: string,
): string {
	const lock = Bun.JSON5.parse(lockText) as {
		workspaces: Record<string, Record<string, unknown>>;
	};
	if (!lock.workspaces || typeof lock.workspaces !== "object")
		throw new Error("Invalid Bun workspace lockfile");
	for (const workspace of Object.values(lock.workspaces))
		delete workspace.version;
	return digest(`${bunVersion}\0${JSON.stringify(lock)}`);
}

function digest(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function sourceFiles(root: string): string[] {
	return readdirSync(root, { withFileTypes: true })
		.filter(
			(entry) =>
				!["node_modules", "bin", "obj", "build", ".cache"].includes(entry.name),
		)
		.flatMap((entry) =>
			entry.isDirectory()
				? sourceFiles(join(root, entry.name))
				: [join(root, entry.name)],
		)
		.sort();
}

async function sourceIdentity(repo: string, files: string[]) {
	const names = files.map((file) => relative(repo, file).replaceAll("\\", "/"));
	return digest(`${JSON.stringify(names)}\0${await hashFiles(files)}`);
}

export async function desktopBuildCacheKeys(repo: string) {
	const dependencies = dependencyIdentity(
		readFileSync(join(repo, "bun.lock"), "utf8"),
		Bun.version,
	);
	const native = digest(
		`${dependencies}:${await sourceIdentity(repo, [
			join(repo, "scripts/release/prepare-native-deps.mjs"),
			join(repo, "scripts/vendor-native-win-arm64.ts"),
			...sourceFiles(join(repo, "packages/macos-process-metrics")),
			...sourceFiles(join(repo, "vendored/win32-arm64")),
			...sourceFiles(join(repo, "patches")),
		])}`,
	);
	const flow = await sourceIdentity(repo, [
		join(repo, "apps/desktop/scripts/build-flow-dictation.ts"),
		join(repo, "apps/desktop/scripts/flow-bundle.ts"),
		...sourceFiles(join(repo, "apps/desktop/native/flow-dictation")),
	]);
	return { dependencies, native, flow };
}

if (import.meta.main) {
	for (const [name, value] of Object.entries(
		await desktopBuildCacheKeys(resolve(import.meta.dirname, "../..")),
	))
		console.log(`${name}=${value}`);
}
