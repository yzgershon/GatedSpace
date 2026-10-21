import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	MAX_USAGE_LINE_BYTES,
	readUsageTranscriptLines,
} from "./usage-transcript-lines";

const directories: string[] = [];
function fixture(content: string | Buffer): string {
	const directory = mkdtempSync(join(tmpdir(), "usage-transcript-"));
	directories.push(directory);
	const file = join(directory, "session.jsonl");
	writeFileSync(file, content);
	return file;
}
async function lines(file: string): Promise<string[]> {
	const result: string[] = [];
	for await (const line of readUsageTranscriptLines(file)) result.push(line);
	return result;
}
afterEach(() => {
	for (const directory of directories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("bounded usage transcript reader", () => {
	test("preserves UTF-8 across chunks, CRLF and a final unterminated line", async () => {
		const first = `${"x".repeat(64 * 1024 - 1)}שלום`;
		const file = fixture(`${first}\r\n\n{"usage":1}\n{"usage":2}`);
		expect(await lines(file)).toEqual([
			`${first}\r`,
			'{"usage":1}',
			'{"usage":2}',
		]);
	});

	test("skips an oversized record and still reads usage after it", async () => {
		const file = fixture(
			`{"usage":1}\n${"x".repeat(MAX_USAGE_LINE_BYTES + 65_537)}\n{"usage":2}\n`,
		);
		expect(await lines(file)).toEqual(['{"usage":1}', '{"usage":2}']);
	});

	test("keeps a line at the limit and skips an oversized final record", async () => {
		const atLimit = "x".repeat(MAX_USAGE_LINE_BYTES);
		const file = fixture(`${atLimit}\n${atLimit}x`);
		const result = await lines(file);
		expect(result).toHaveLength(1);
		expect(result[0]).toHaveLength(MAX_USAGE_LINE_BYTES);
	});

	test("missing files do not reject the complete usage request", async () => {
		expect(await lines(join(tmpdir(), "missing-usage-file.jsonl"))).toEqual([]);
	});

	test("yields to the event loop during a large scan", async () => {
		const file = fixture("{}\n".repeat(1_000_000));
		let ticks = 0;
		const timer = setInterval(() => ticks++, 1);
		let count = 0;
		try {
			for await (const _line of readUsageTranscriptLines(file)) count++;
		} finally {
			clearInterval(timer);
		}
		expect(count).toBe(1_000_000);
		expect(ticks).toBeGreaterThan(0);
	});
});
