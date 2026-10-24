import { afterEach, expect, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmdirSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EnsembleGroup } from "../../../shared/ensemble";
import { EnsembleFileStorage } from "./storage";

const directories: string[] = [];
function fixture() {
	const directory = mkdtempSync(join(tmpdir(), "gatedspace-flock-test-"));
	directories.push(directory);
	return {
		storage: new EnsembleFileStorage(directory),
		path: join(directory, "groups.json"),
	};
}
afterEach(() => {
	for (const directory of directories.splice(0)) {
		for (const name of ["groups.json", "groups.json.tmp"]) {
			const file = join(directory, name);
			if (existsSync(file)) unlinkSync(file);
		}
		rmdirSync(directory);
	}
});

const group: EnsembleGroup = {
	id: "test-group",
	title: "Repair workshop",
	goal: "Plan the workshop",
	criteria: "A reviewed plan",
	status: "draft",
	commanderId: "m1",
	members: [],
	messages: [],
	tasks: [],
	artifacts: [],
	decisions: [],
	events: [],
	maxMessages: 12,
	concurrency: 2,
	createdAt: 1,
	updatedAt: 1,
	context: [{ name: "constraints.md", text: "Six tables; two mentors." }],
	agreements: ["review", "evidence"],
};

test("atomic snapshots retain group-scoped references and agreements across reload", () => {
	const { storage } = fixture();
	expect(storage.load()).toEqual([]);
	storage.save([group]);
	expect(storage.load()).toEqual([group]);
	storage.save([{ ...group, title: "Updated brief" }]);
	expect(storage.load()[0].title).toBe("Updated brief");
});

test("corrupt or unsupported snapshots fail visibly without overwriting the original", () => {
	const { storage, path } = fixture();
	for (const original of [
		"{unfinished",
		JSON.stringify({ version: 99, groups: [] }),
	]) {
		writeFileSync(path, original);
		expect(() => storage.load()).toThrow("original file was preserved");
		expect(readFileSync(path, "utf8")).toBe(original);
	}
});

test("legacy snapshots without optional reference fields remain readable", () => {
	const { storage, path } = fixture();
	const { context: _context, agreements: _agreements, ...legacy } = group;
	writeFileSync(path, JSON.stringify({ version: 1, groups: [legacy] }));
	expect(storage.load()[0].goal).toBe(group.goal);
});
