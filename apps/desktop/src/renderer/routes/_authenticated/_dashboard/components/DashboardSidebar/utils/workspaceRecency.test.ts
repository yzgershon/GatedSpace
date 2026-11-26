import { describe, expect, test } from "bun:test";
import type {
	DashboardSidebarProject,
	DashboardSidebarWorkspace,
} from "../types";
import { sortWorkspaceProjects } from "./workspaceRecency";

const workspace = (id: string) => ({ id }) as DashboardSidebarWorkspace;
const project = (id: string, ids: string[]): DashboardSidebarProject =>
	({
		id,
		children: ids.map((id) => ({
			type: "workspace",
			workspace: workspace(id),
		})),
	}) as DashboardSidebarProject;

describe("workspace visit order", () => {
	test("recent visits reorder projects and their workspaces without mutating manual order", () => {
		const original = [project("dev", ["a", "b"]), project("school", ["c"])];
		const before = JSON.stringify(original);
		const result = sortWorkspaceProjects(original, { b: 10, c: 20 }, true, []);
		expect(result.map((p) => p.id)).toEqual(["school", "dev"]);
		expect(
			result[1].children.map((c) => c.type === "workspace" && c.workspace.id),
		).toEqual(["b", "a"]);
		expect(JSON.stringify(original)).toBe(before);
		expect(
			sortWorkspaceProjects(original, { b: 10, c: 20 }, false, []),
		).toEqual(original);
	});
	test("pinned projects stay first and equal or missing visits preserve manual order", () => {
		const original = [
			project("a", ["w1"]),
			project("b", ["w2"]),
			project("c", ["w3"]),
		];
		expect(
			sortWorkspaceProjects(original, { w3: 5 }, true, ["b"]).map((p) => p.id),
		).toEqual(["b", "c", "a"]);
		expect(
			sortWorkspaceProjects(original, {}, true, []).map((p) => p.id),
		).toEqual(["a", "b", "c"]);
	});
	test("section members remain in their section and manual order survives", () => {
		const original = [project("a", ["w1"])];
		original[0].children.push({
			type: "section",
			section: { id: "group", workspaces: [workspace("w2"), workspace("w3")] },
		} as DashboardSidebarProject["children"][number]);
		const result = sortWorkspaceProjects(original, { w3: 30 }, true, []);
		const first = result[0].children[0];
		expect(first.type).toBe("section");
		if (first.type === "section")
			expect(first.section.workspaces.map((w) => w.id)).toEqual(["w3", "w2"]);
		expect(sortWorkspaceProjects(original, { w3: 30 }, false, [])).toEqual(
			original,
		);
	});
	test("empty projects and sections remain visible without invalid sort values", () => {
		const original = [project("empty", []), project("active", ["w1"])];
		expect(
			sortWorkspaceProjects(original, { w1: 100 }, true, []).map((p) => p.id),
		).toEqual(["active", "empty"]);
	});
});
