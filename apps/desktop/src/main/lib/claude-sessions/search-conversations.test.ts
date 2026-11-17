import { afterEach, expect, test } from "bun:test";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	searchConversations,
	transcriptContains,
} from "./search-conversations";

const roots: string[] = [];
afterEach(async () => {
	for (const path of roots.splice(0))
		await rm(path, { recursive: true, force: true });
});
async function transcript(body: string) {
	const root = await mkdtemp(join(tmpdir(), "gs-conversation-search-"));
	roots.push(root);
	const path = join(root, "session.jsonl");
	await writeFile(path, body);
	return path;
}
test("finds early Claude dialogue beyond the old two-megabyte tail", async () => {
	const path = await transcript(
		`${JSON.stringify({ message: { content: "The blue library entrance" } })}\n${JSON.stringify({ message: { content: "x".repeat(2_100_000) } })}\n`,
	);
	expect(await transcriptContains(path, "blue library")).toBe(true);
});
test("searches decoded Codex text, ignores metadata, and refreshes after append", async () => {
	const path = await transcript(
		'{"type":"session_meta","payload":{"cwd":"secretneedle"}}\n{"type":"response_item","payload":{"content":[{"text":"caf\\u00e9\\nreview"}]}}\n',
	);
	expect(await transcriptContains(path, "café\nreview")).toBe(true);
	expect(await transcriptContains(path, "secretneedle")).toBe(false);
	expect(await transcriptContains(path, "new revision")).toBe(false);
	await appendFile(
		path,
		`${JSON.stringify({
			type: "event_msg",
			payload: { message: "new revision" },
		})}\n`,
	);
	expect(await transcriptContains(path, "new revision")).toBe(true);
});
test("returns older matching summaries and tolerates deleted transcripts", async () => {
	const path = await transcript(
		`${JSON.stringify({ message: { content: "borrowed telescope" } })}\n`,
	);
	const rows = [
		{ sessionId: "old", title: "Night sky", cwd: null, filePath: path },
		{ sessionId: "gone", title: "Other", cwd: null, filePath: `${path}.gone` },
	];
	expect(
		(await searchConversations(rows, "telescope")).map((r) => r.sessionId),
	).toEqual(["old"]);
});
