import { expect, test } from "bun:test";
import { groupSessionCollections } from "./collections";

test("collections distinguish same-name projects, normalize Windows paths, and keep pins first", () => {
	const rows = [
		{ cwd: "C:\\Dev\\app", lastModified: 1 },
		{ cwd: "c:/dev/app/", lastModified: 2 },
		{ cwd: "D:/Dev/app", lastModified: 3 },
		{ cwd: "/work/App", lastModified: 4 },
		{ cwd: "/work/app", lastModified: 5 },
		{ cwd: null, lastModified: 0, pinned: true },
	];
	const groups = groupSessionCollections(rows);
	expect(groups.map(([key]) => key)).toEqual([
		"@pinned",
		"/work/app",
		"/work/App",
		"d:/dev/app",
		"c:/dev/app",
	]);
	expect(groups.at(-1)?.[1]).toHaveLength(2);
});
