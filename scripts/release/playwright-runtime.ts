import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function playwrightEntry(
	repo: string,
	lockfile: string,
	exists: (path: string) => boolean = existsSync,
) {
	const version = lockfile.match(
		/"playwright":\s*\["playwright@([^"\s]+)"/,
	)?.[1];
	const candidates = [
		...(version
			? [
					join(
						repo,
						"node_modules/.bun",
						`playwright@${version}`,
						"node_modules/playwright/index.mjs",
					),
				]
			: []),
		join(repo, "node_modules/playwright/index.mjs"),
		join(repo, "apps/desktop/node_modules/playwright/index.mjs"),
	];
	const entry = candidates.find(exists);
	if (!entry)
		throw new Error(
			"Playwright runtime missing from the build checkout. Run bun install before compiling the installer.",
		);
	return pathToFileURL(entry).href;
}

export function resolvePlaywrightRuntime(repo: string) {
	return playwrightEntry(repo, readFileSync(join(repo, "bun.lock"), "utf8"));
}
