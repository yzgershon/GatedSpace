import { expect, test } from "bun:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { playwrightEntry } from "./playwright-runtime";

test("isolated builds resolve locked Bun dependency even without a top-level link or shell environment", () => {
	const repo = "C:/Build checkout";
	const installed = join(
		repo,
		"node_modules/.bun/playwright@1.59.1/node_modules/playwright/index.mjs",
	);
	expect(
		playwrightEntry(
			repo,
			'"playwright": ["playwright@1.59.1", ""]',
			(path) => path === installed,
		),
	).toBe(pathToFileURL(installed).href);
});
test("standard links work and missing runtime fails before compilation", () => {
	const repo = "C:/Build checkout";
	const direct = join(repo, "apps/desktop/node_modules/playwright/index.mjs");
	expect(playwrightEntry(repo, "", (path) => path === direct)).toBe(
		pathToFileURL(direct).href,
	);
	expect(() => playwrightEntry(repo, "", () => false)).toThrow(
		"Playwright runtime missing",
	);
});
