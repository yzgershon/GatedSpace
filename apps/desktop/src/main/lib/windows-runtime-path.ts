import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** App-private tools are fallbacks, never a machine-wide PATH modification. */
export function augmentWindowsRuntimePath(
	env: NodeJS.ProcessEnv,
	options: {
		platform?: string;
		resourcesPath?: string;
		home?: string;
		exists?: (path: string) => boolean;
	} = {},
): void {
	if ((options.platform ?? process.platform) !== "win32") return;
	const exists = options.exists ?? existsSync;
	const home = options.home ?? homedir();
	const resources = options.resourcesPath ?? process.resourcesPath;
	const additions = [join(home, ".local", "bin")];
	if (resources) additions.push(join(resources, "resources", "git", "cmd"));
	const entries = (env.PATH ?? env.Path ?? "").split(";").filter(Boolean);
	const known = new Set(entries.map((entry) => entry.toLowerCase()));
	for (const entry of additions) {
		if (exists(entry) && !known.has(entry.toLowerCase())) entries.push(entry);
	}
	env.PATH = entries.join(";");
	env.Path = env.PATH;
}
