import { afterEach, beforeEach, expect, test } from "bun:test";
import { createTestHost, type TestHost } from "../helpers/createTestHost";
import { seedProject } from "../helpers/seed";

let host: TestHost;
let id: string;
beforeEach(async () => {
	host = await createTestHost();
	id = seedProject(host, {
		repoPath: "C:/fixture/workspace",
		repoName: "original",
	}).id;
});
afterEach(async () => {
	await host?.dispose();
});

test("renames a local project without cloud metadata and preserves its directory", async () => {
	await host.trpc.project.rename.mutate({
		projectId: id,
		name: "  Agent studio  ",
	});
	expect(await host.trpc.project.get.query({ projectId: id })).toMatchObject({
		name: "Agent studio",
		repoPath: "C:/fixture/workspace",
	});
	expect((await host.trpc.project.list.query())[0].name).toBe("Agent studio");
	expect(
		host.apiCalls.filter((call) => call.path.includes("Project.update")),
	).toEqual([]);
});
test("rejects blank names, missing projects and unauthenticated requests", async () => {
	await expect(
		host.trpc.project.rename.mutate({ projectId: id, name: "   " }),
	).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
	await expect(
		host.trpc.project.rename.mutate({
			projectId: crypto.randomUUID(),
			name: "Missing",
		}),
	).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
	await expect(
		host.unauthenticatedTrpc.project.rename.mutate({
			projectId: id,
			name: "No",
		}),
	).rejects.toMatchObject({ data: { code: "UNAUTHORIZED" } });
	expect((await host.trpc.project.list.query())[0].name).toBeNull();
});
