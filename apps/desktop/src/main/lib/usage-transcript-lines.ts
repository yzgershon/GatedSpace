import { createReadStream } from "node:fs";

// Transcript lines can contain screenshots or tool output of arbitrary size.
// readline would accumulate even one such line without a bound. Limit both the
// read buffer and the pending line; this reader never edits the transcript.
const CHUNK_BYTES = 64 * 1024;
export const MAX_USAGE_LINE_BYTES = 4 * 1024 * 1024;

export async function* readUsageTranscriptLines(
	filePath: string,
): AsyncGenerator<string> {
	const stream = createReadStream(filePath, { highWaterMark: CHUNK_BYTES });
	let parts: Buffer[] = [];
	let length = 0;
	let skipping = false;
	try {
		for await (const chunk of stream) {
			const bytes = chunk as Buffer;
			let start = 0;
			while (start < bytes.length) {
				const newline = bytes.indexOf(10, start);
				const end = newline === -1 ? bytes.length : newline;
				const size = end - start;
				if (!skipping && length + size > MAX_USAGE_LINE_BYTES) {
					parts = [];
					length = 0;
					skipping = true;
				}
				if (!skipping && size > 0) {
					parts.push(bytes.subarray(start, end));
					length += size;
				}
				if (newline === -1) break;
				if (!skipping && length > 0) {
					yield Buffer.concat(parts, length).toString("utf8");
				}
				parts = [];
				length = 0;
				skipping = false;
				start = newline + 1;
			}
		}
		if (!skipping && length > 0) {
			yield Buffer.concat(parts, length).toString("utf8");
		}
	} catch {
		// A transcript can be archived, removed, or temporarily locked while
		// scanning. Keep the readable history from the other files available.
	} finally {
		stream.destroy();
	}
}
