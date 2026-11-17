import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTimeline } from "shared/claude-session/timeline";
import { readTranscriptFile } from "./transcript-reader";

const directories: string[] = [];
async function transcript(lines: unknown[], newline = "\n") {
	const directory = await mkdtemp(join(tmpdir(), "gatedspace-history-"));
	directories.push(directory);
	const file = join(directory, "session.jsonl");
	await writeFile(
		file,
		lines.map((line) => JSON.stringify(line)).join(newline),
	);
	return file;
}
afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((dir) => rm(dir, { recursive: true })),
	);
});

const user = (uuid: string, content: unknown) => ({
	type: "user",
	uuid,
	message: { role: "user", content },
});
const assistant = (uuid: string, content: unknown) => ({
	type: "assistant",
	uuid,
	message: { id: uuid, role: "assistant", content },
});

test("image-heavy request bookkeeping cannot erase the conversation on restart", async () => {
	const file = await transcript([
		user("goal", "Build the Flock preview"),
		assistant("reply", [
			{ type: "text", text: "Here is the design direction." },
		]),
		assistant("read", [
			{
				type: "tool_use",
				id: "tool",
				name: "Read",
				input: { file_path: "preview.png" },
			},
		]),
		user("result", [
			{
				type: "tool_result",
				tool_use_id: "tool",
				content: [
					{
						type: "image",
						source: {
							type: "base64",
							data: "A".repeat(650_000),
							media_type: "image/png",
						},
					},
				],
			},
		]),
		{ type: "api-request-blob", data: "A".repeat(1_700_000) },
		assistant("limit", [
			{ type: "text", text: "You've hit your 5-hour limit." },
		]),
	]);
	const before = await readFile(file);
	const events = await readTranscriptFile(file);
	expect(events.map((event) => ("uuid" in event ? event.uuid : null))).toEqual([
		"goal",
		"reply",
		"read",
		"result",
		"limit",
	]);
	const timeline = buildTimeline(events);
	expect(
		timeline.items.some(
			(item) => item.kind === "user" && item.text === "Build the Flock preview",
		),
	).toBe(true);
	expect(
		timeline.items.some(
			(item) => item.kind === "tool" && item.status === "success",
		),
	).toBe(true);
	expect(await readFile(file)).toEqual(before);
});

test("multi-chunk Unicode prompts and attached photos survive complete-line reads", async () => {
	const prompt = "Design → שלום 🎨 ".repeat(20_000);
	const image = "A".repeat(2_000_000);
	const file = await transcript(
		[
			user("image", [
				{ type: "text", text: prompt },
				{
					type: "image",
					source: { type: "base64", media_type: "image/png", data: image },
				},
			]),
			assistant("answer", [{ type: "text", text: "The image is attached." }]),
		],
		"\r\n",
	);
	const timeline = buildTimeline(await readTranscriptFile(file));
	const first = timeline.items[0];
	expect(first?.kind).toBe("user");
	if (first?.kind !== "user") throw new Error("Missing restored prompt");
	expect(first.text).toBe(prompt.trim());
	expect(first.attachments?.[0]?.thumbnail).toBe(
		`data:image/png;base64,${image}`,
	);
});

test("malformed trailing writes and synthetic entries do not hide earlier prompts", async () => {
	const file = await transcript([
		user("first", "Keep this prompt"),
		{ ...user("meta", "internal reminder"), isMeta: true },
		user("command", "<command-name>/model</command-name>"),
		{ type: "assistant", message: null },
		user("last", "Keep this too"),
	]);
	await writeFile(
		file,
		`${await readFile(file, "utf8")}\n{"type":"assistant"`,
		"utf8",
	);
	const events = await readTranscriptFile(file);
	expect(events.map((event) => ("uuid" in event ? event.uuid : null))).toEqual([
		"first",
		"last",
	]);
	expect(
		events.every(
			(event) =>
				"parent_tool_use_id" in event && event.parent_tool_use_id === null,
		),
	).toBe(true);
});

test("the event ceiling retains newest messages chronologically and explains the limit", async () => {
	const file = await transcript(
		Array.from({ length: 4_050 }, (_, i) => user(String(i), `Message ${i}`)),
	);
	const events = await readTranscriptFile(file);
	expect(events).toHaveLength(4_001);
	expect(events[0]?.type).toBe("local_notice");
	expect(events[1]).toMatchObject({ uuid: "50" });
	expect(events.at(-1)).toMatchObject({ uuid: "4049" });
});

test("empty files restore cleanly", async () => {
	expect(await readTranscriptFile(await transcript([]))).toEqual([]);
});
