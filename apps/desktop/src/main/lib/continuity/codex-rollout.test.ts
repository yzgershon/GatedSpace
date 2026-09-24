import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportCodexRollout, retargetCodexRollout } from "./codex-rollout";

const dirs: string[] = [];
afterEach(async () => {
	for (const dir of dirs.splice(0))
		await rm(dir, { recursive: true, force: true });
});
const encode = (rows: unknown[]) =>
	`${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
test("a fork contains its bounded parent history and remaps only native metadata", async () => {
	const dir = await mkdtemp(join(tmpdir(), "gatedspace-rollout-test-"));
	dirs.push(dir);
	const parentId = randomUUID();
	const childId = randomUUID();
	const parent = join(dir, "parent.jsonl");
	const child = join(dir, "child.jsonl");
	const prefix = encode([
		{
			type: "session_meta",
			payload: { id: parentId, cwd: "C:/Old", history_mode: "paginated" },
			ordinal: 0,
		},
		{
			type: "response_item",
			payload: { role: "user", text: "First prompt C:/Old" },
			ordinal: 1,
		},
		{
			type: "response_item",
			payload: { role: "assistant", text: "First response" },
			ordinal: 2,
		},
	]);
	await writeFile(
		parent,
		prefix +
			encode([
				{
					type: "response_item",
					payload: { text: "Later parent work must not leak into fork" },
					ordinal: 3,
				},
			]),
	);
	await writeFile(
		child,
		encode([
			{
				type: "session_meta",
				payload: {
					id: childId,
					history_base: {
						thread_id: parentId,
						end_ordinal_exclusive: 3,
						end_byte_offset: Buffer.byteLength(prefix),
					},
				},
				ordinal: 0,
			},
			{
				type: "turn_context",
				payload: { cwd: "C:/Old", workspace_roots: ["C:/Old"] },
				ordinal: 3,
			},
			{ type: "response_item", payload: { text: "Child prompt" }, ordinal: 4 },
		]),
	);
	const exported = await exportCodexRollout(child, (id) =>
		id === parentId ? parent : null,
	);
	expect(exported).toContain("First prompt");
	expect(exported).toContain("First response");
	expect(exported).toContain("Child prompt");
	expect(exported).not.toContain("Later parent work");
	expect(exported).not.toContain("history_base");
	const id = randomUUID();
	const rows = retargetCodexRollout(exported, id, "D:/Restored")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	expect(rows[0].payload.id).toBe(id);
	expect(rows[0].payload.history_mode).toBe("legacy");
	expect(rows[1].payload.text).toBe("First prompt C:/Old");
	expect(rows[3].payload.cwd).toBe("D:/Restored");
	expect(rows[3].payload.workspace_roots).toEqual(["D:/Restored"]);
});
test("missing parent and partial JSONL stop export instead of losing context", async () => {
	const dir = await mkdtemp(join(tmpdir(), "gatedspace-rollout-test-"));
	dirs.push(dir);
	const file = join(dir, "history.jsonl");
	await writeFile(
		file,
		encode([
			{
				type: "session_meta",
				payload: {
					history_base: {
						thread_id: randomUUID(),
						end_ordinal_exclusive: 3,
						end_byte_offset: 40,
					},
				},
			},
		]),
	);
	await expect(exportCodexRollout(file, () => null)).rejects.toThrow("missing");
	await writeFile(file, '{"type":"session_meta","payload":{}}');
	await expect(exportCodexRollout(file, () => null)).rejects.toThrow(
		"still being written",
	);
});
