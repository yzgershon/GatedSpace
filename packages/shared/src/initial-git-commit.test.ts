import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureInitialGitCommit } from "./initial-git-commit";

const owned: string[] = [];
afterEach(() => {
	for (const path of owned.splice(0)) {
		if (!path.startsWith(join(tmpdir(), "gatedspace-first-git-")))
			throw new Error("Unsafe cleanup");
		rmSync(path, { recursive: true, force: true });
	}
});
function repo() {
	const path = mkdtempSync(join(tmpdir(), "gatedspace-first-git-"));
	owned.push(path);
	const config = join(path, "empty-global");
	writeFileSync(config, "");
	const env = {
		...process.env,
		GIT_CONFIG_GLOBAL: config,
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_AUTHOR_NAME: "",
		GIT_AUTHOR_EMAIL: "",
		GIT_COMMITTER_NAME: "",
		GIT_COMMITTER_EMAIL: "",
	};
	// Empty identity env overrides -c. Remove it to model a clean Windows account.
	for (const key of [
		"GIT_AUTHOR_NAME",
		"GIT_AUTHOR_EMAIL",
		"GIT_COMMITTER_NAME",
		"GIT_COMMITTER_EMAIL",
	])
		delete (env as NodeJS.ProcessEnv)[key];
	const raw = async (args: string[]) =>
		execFileSync(process.env.TEST_GIT_BINARY ?? "git", args, {
			cwd: path,
			env,
			encoding: "utf8",
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
	return { path, config, raw };
}

describe("first project on a clean PC", () => {
	test("creates an empty checkpoint without identity, signing keys, staging user files, or global changes", async () => {
		const git = repo();
		await git.raw(["init", "-b", "main"]);
		await git.raw(["config", "commit.gpgsign", "true"]);
		writeFileSync(join(git.path, "private.txt"), "keep staged");
		await git.raw(["add", "private.txt"]);
		await ensureInitialGitCommit(git);
		expect((await git.raw(["ls-tree", "--name-only", "HEAD"])).trim()).toBe("");
		expect(await git.raw(["diff", "--cached", "--name-only"])).toContain(
			"private.txt",
		);
		expect(await git.raw(["log", "-1", "--format=%an <%ae>"])).toContain(
			"GatedSpace <noreply@gatedspace.local>",
		);
		expect(readFileSync(git.config, "utf8")).toBe("");
		expect(readFileSync(join(git.path, "private.txt"), "utf8")).toBe(
			"keep staged",
		);
	});
	test("preserves configured identity and existing history on repeated open", async () => {
		const git = repo();
		await git.raw(["init", "-b", "main"]);
		await git.raw(["config", "user.name", "Existing User"]);
		await git.raw(["config", "user.email", "existing@example.test"]);
		await ensureInitialGitCommit(git);
		const head = await git.raw(["rev-parse", "HEAD"]);
		await ensureInitialGitCommit(git);
		expect(await git.raw(["rev-parse", "HEAD"])).toBe(head);
		expect(await git.raw(["log", "-1", "--format=%an"])).toContain(
			"Existing User",
		);
	});
});
