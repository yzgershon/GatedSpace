import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CloudDisabledError } from "../../src/api/createLocalOnlyApiClient/createLocalOnlyApiClient";
import { createTestHost, type TestHost } from "../helpers/createTestHost";
import { createGitFixture, type GitFixture } from "../helpers/git-fixture";

describe("local project import and reopen", () => {
	let host: TestHost;
	let repo: GitFixture;
	beforeEach(async () => {
		repo = await createGitFixture();
		host = await createTestHost({
			localOnly: true,
			organizationId: "00000000-0000-4000-8000-000000000002",
		});
		await host.trpc.settings.worktreeLocation.set.mutate({
			path: join(repo.repoPath, ".worktrees"),
		});
		for (const path of [
			"v2Project.get.query",
			"v2Project.findByGitHubRemote.query",
			"v2Project.create.mutate",
			"v2Project.delete.mutate",
			"v2Project.linkRepoCloneUrl.mutate",
			"host.ensure.mutate",
			"v2Workspace.create.mutate",
		]) {
			host.setApi(path, () => {
				throw new CloudDisabledError(path);
			});
		}
	});
	afterEach(async () => {
		await host?.dispose();
		repo?.dispose();
	});

	async function importProject() {
		return host.trpc.project.create.mutate({
			name: "Clash project",
			mode: { kind: "importLocal", repoPath: repo.repoPath },
		});
	}
	function expectNoProjectCloudCalls() {
		expect(host.apiCalls).toEqual([]);
	}

	test("opens a plain folder and preserves its files without any cloud account", async () => {
		const plain = join(repo.repoPath, "plain-folder");
		mkdirSync(plain);
		writeFileSync(join(plain, "notes.txt"), "Existing work");
		const created = await host.trpc.project.create.mutate({
			name: "Notes",
			mode: { kind: "importLocal", repoPath: plain, initIfNeeded: true },
		});
		expect(created.mainWorkspaceId).toBeTruthy();
		expect(await Bun.file(join(plain, "notes.txt")).text()).toBe(
			"Existing work",
		);
		expectNoProjectCloudCalls();
	});

	test("creates and reopens an additional workspace without cloud registration", async () => {
		const project = await importProject();
		const input = {
			projectId: project.projectId,
			name: "First task",
			branch: "first-task",
		};
		const created = await host.trpc.workspaces.create.mutate(input);
		expect(created.workspace.branch).toBe("first-task");
		expect(created.warnings ?? []).toEqual([]);
		const reopened = await host.trpc.workspaces.create.mutate(input);
		expect(reopened.workspace.id).toBe(created.workspace.id);
		const renamed = await host.trpc.workspace.update.mutate({
			id: created.workspace.id,
			name: "Renamed task",
		});
		expect(renamed.name).toBe("Renamed task");
		expectNoProjectCloudCalls();
	});

	test("adopts an existing worktree without cloud registration", async () => {
		const project = await importProject();
		const worktreePath = join(repo.repoPath, ".worktrees", "existing-task");
		await repo.git.raw([
			"worktree",
			"add",
			"-b",
			"existing-task",
			worktreePath,
		]);
		const adopted = await host.trpc.workspaceCreation.adopt.mutate({
			projectId: project.projectId,
			workspaceName: "Existing task",
			branch: "existing-task",
			worktreePath,
		});
		expect(adopted.workspace.branch).toBe("existing-task");
		expect(adopted.warnings).toEqual([]);
		expectNoProjectCloudCalls();
	});

	test("imports a repository with a GitHub remote without cloud discovery", async () => {
		await repo.git.addRemote("origin", "https://github.com/example/clash.git");
		for (const walkAllRemotes of [false, true]) {
			const found = await host.trpc.project.findByPath.query({
				repoPath: repo.repoPath,
				walkAllRemotes,
			});
			expect(found).toEqual({ candidates: [], cloudErrors: [] });
		}
		const created = await importProject();
		expect(created.mainWorkspaceId).toBeTruthy();
		expectNoProjectCloudCalls();
	});

	test("reopening the same folder keeps its project, name and main workspace", async () => {
		const created = await importProject();
		const found = await host.trpc.project.findByPath.query({
			repoPath: repo.repoPath,
		});
		expect(found.candidates).toHaveLength(1);
		expect(found.candidates[0]?.name).toBe("Clash project");
		const reopened = await host.trpc.project.setup.mutate({
			projectId: created.projectId,
			mode: { kind: "import", repoPath: repo.repoPath },
		});
		expect(reopened.mainWorkspaceId).toBe(created.mainWorkspaceId);
		expectNoProjectCloudCalls();
	});

	test("subfolder discovery reuses the existing repository without a cloud call", async () => {
		const created = await importProject();
		const nested = join(repo.repoPath, "nested-project");
		mkdirSync(nested);
		const found = await host.trpc.project.findByPath.query({
			repoPath: nested,
		});
		expect(found.candidates[0]?.id).toBe(created.projectId);
		const reopened = await host.trpc.project.setup.mutate({
			projectId: created.projectId,
			mode: { kind: "import", repoPath: nested },
		});
		expect(reopened.mainWorkspaceId).toBe(created.mainWorkspaceId);
		expectNoProjectCloudCalls();
	});

	test("does not invent a local project for an unknown ID", async () => {
		await expect(
			host.trpc.project.setup.mutate({
				projectId: randomUUID(),
				mode: { kind: "import", repoPath: repo.repoPath },
			}),
		).rejects.toThrow("not set up on this PC");
		expectNoProjectCloudCalls();
	});

	test("removes only the local project record and preserves its files", async () => {
		const created = await importProject();
		await host.trpc.project.remove.mutate({ projectId: created.projectId });
		expect(existsSync(join(repo.repoPath, "README.md"))).toBe(true);
		expect(
			await host.trpc.project.get.query({ projectId: created.projectId }),
		).toBeNull();
		expectNoProjectCloudCalls();
	});
});
