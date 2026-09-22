import { describe, expect, test } from "bun:test";
import { matchingProject, resolveCodexProject } from "./projects";

describe("Codex project association", () => {
	const projects = [
		{ id: "dev", roots: [{ path: "C:\\Dev" }] },
		{ id: "brain", roots: [{ path: "C:\\Dev\\SecondBrain" }] },
	];
	test("uses the pane's closest project and Windows path semantics", () => {
		expect(matchingProject(projects, "c:/dev/secondbrain/src/")).toBe("brain");
		expect(matchingProject(projects, "C:/Dev/SecondBrain-copy")).toBe("dev");
		expect(matchingProject(projects, "C:/Development")).toBeUndefined();
	});
	test("looks through all pages before creating a folder project", async () => {
		const calls: string[] = [];
		const id = await resolveCodexProject(async (method, params) => {
			calls.push(method);
			return params.cursor
				? { data: [projects[1]] }
				: { data: [projects[0]], nextCursor: "next" };
		}, "C:/Dev/SecondBrain");
		expect(id).toBe("brain");
		expect(calls).toEqual(["project/list", "project/list"]);
	});
	test("keeps POSIX folder names case-sensitive", () => {
		const projects = [{ id: "app", roots: [{ path: "/workspace/App" }] }];
		expect(matchingProject(projects, "/workspace/App/src")).toBe("app");
		expect(matchingProject(projects, "/workspace/app/src")).toBeUndefined();
	});
	test("creates a stable folder association when none exists", async () => {
		let created: Record<string, unknown> | undefined;
		const id = await resolveCodexProject(async (method, params) => {
			if (method === "project/list") return { data: [] };
			created = params;
			return { project: { id: "new" } };
		}, "C:\\Projects\\App");
		expect(id).toBe("new");
		expect(created).toEqual({
			name: "App",
			roots: [{ path: "C:\\Projects\\App" }],
			idempotencyKey: "gatedspace:c:/projects/app",
		});
	});
});
