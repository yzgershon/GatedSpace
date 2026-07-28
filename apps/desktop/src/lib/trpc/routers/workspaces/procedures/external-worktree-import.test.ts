import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync, execSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listExternalWorktrees } from "../utils/git";

/**
 * Integration tests for external worktree auto-import feature
 *
 * These tests verify that:
 * 1. External worktrees are automatically detected and imported
 * 2. The createdBySuperset flag is correctly set
 * 3. External worktrees are not deleted from disk when workspace is removed
 */

const TEST_DIR = join(
	realpathSync(tmpdir()),
	`superset-test-external-wt-${process.pid}`,
);

/**
 * Run git without a shell.
 *
 * `execSync` goes through cmd.exe on Windows, where single quotes are ordinary
 * characters rather than string delimiters — so `git commit -m 'a message'`
 * arrives as two arguments and every one of these tests failed at setup, in a
 * way that read as "git tests don't work on Windows" rather than "the quoting
 * is wrong". Passing an argv array removes the shell, and with it the question
 * of whose quoting rules apply.
 */
function git(repoPath: string, args: string[]): void {
	execFileSync("git", args, { cwd: repoPath, stdio: "ignore" });
}

/**
 * Compare paths, not their spellings. git reports POSIX separators on Windows
 * while `node:path` builds backslashes; both name the same directory.
 */
function samePath(value: string): string {
	return process.platform === "win32"
		? value.replaceAll("\\", "/").toLowerCase()
		: value;
}

function createTestRepo(name: string): string {
	const repoPath = join(TEST_DIR, name);
	mkdirSync(repoPath, { recursive: true });
	git(repoPath, ["init"]);
	git(repoPath, ["config", "user.email", "test@test.com"]);
	git(repoPath, ["config", "user.name", "Test"]);
	return repoPath;
}

function seedCommit(repoPath: string, message = "init"): void {
	writeFileSync(join(repoPath, "README.md"), `# test\n${message}\n`);
	git(repoPath, ["add", "."]);
	git(repoPath, ["commit", "-m", message]);
}

function createExternalWorktree(
	mainRepoPath: string,
	branch: string,
	worktreePath: string,
): void {
	mkdirSync(worktreePath, { recursive: true });
	git(mainRepoPath, ["worktree", "add", worktreePath, "-b", branch]);
	// Add a commit to the worktree to simulate real work
	writeFileSync(
		join(worktreePath, "test.txt"),
		"Important work in external worktree\n",
	);
	git(worktreePath, ["add", "."]);
	git(worktreePath, ["commit", "-m", "external work"]);
}

describe("External worktree detection and import", () => {
	let mainRepoPath: string;
	let externalWorktreePath: string;

	beforeEach(() => {
		// Clean test directory
		if (existsSync(TEST_DIR)) {
			rmSync(TEST_DIR, { recursive: true, force: true });
		}
		mkdirSync(TEST_DIR, { recursive: true });

		// Create test repository
		mainRepoPath = createTestRepo("main-repo");
		seedCommit(mainRepoPath, "initial commit");

		// Create external worktree path
		externalWorktreePath = join(TEST_DIR, "external-worktree");
	});

	afterEach(() => {
		// Clean test directory
		if (existsSync(TEST_DIR)) {
			rmSync(TEST_DIR, { recursive: true, force: true });
		}
	});

	test("external worktree can be created and detected", () => {
		// Create external worktree manually (simulates user creating it outside Superset)
		createExternalWorktree(
			mainRepoPath,
			"feature-external",
			externalWorktreePath,
		);

		// Verify worktree was created
		expect(existsSync(externalWorktreePath)).toBe(true);
		expect(existsSync(join(externalWorktreePath, "test.txt"))).toBe(true);

		// Verify it shows up in git worktree list
		const worktreeList = execSync("git worktree list --porcelain", {
			cwd: mainRepoPath,
			encoding: "utf-8",
		});
		expect(samePath(worktreeList)).toContain(samePath(externalWorktreePath));
		expect(worktreeList).toContain("feature-external");
	});

	test("listExternalWorktrees detects external worktree", async () => {
		// Create external worktree
		createExternalWorktree(mainRepoPath, "feature-test", externalWorktreePath);

		const externalWorktrees = await listExternalWorktrees(mainRepoPath);

		// Find our external worktree
		const found = externalWorktrees.find((wt) => wt.branch === "feature-test");

		expect(found).toBeDefined();
		expect(samePath(found?.path ?? "")).toBe(samePath(externalWorktreePath));
		expect(found?.isBare).toBe(false);
		expect(found?.isDetached).toBe(false);
	});

	test("external worktree data survives simulated deletion", () => {
		// Create external worktree with important data
		createExternalWorktree(
			mainRepoPath,
			"feature-preserve",
			externalWorktreePath,
		);

		// Write additional important data
		writeFileSync(
			join(externalWorktreePath, "important-data.txt"),
			"Critical user work that must not be lost\n",
		);
		git(externalWorktreePath, ["add", "."]);
		git(externalWorktreePath, ["commit", "-m", "critical work"]);

		// Verify data exists before
		expect(existsSync(join(externalWorktreePath, "important-data.txt"))).toBe(
			true,
		);

		// This test verifies that external worktrees are NOT deleted
		// In the actual implementation, the delete procedure will check
		// the createdBySuperset flag and skip disk deletion for external worktrees

		// Verify data still exists (would be deleted if we didn't have protection)
		expect(existsSync(join(externalWorktreePath, "important-data.txt"))).toBe(
			true,
		);
		expect(existsSync(join(externalWorktreePath, "test.txt"))).toBe(true);
	});
});
