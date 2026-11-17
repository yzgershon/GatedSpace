import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";

type Transcript = {
	sessionId: string;
	filePath: string;
	title: string;
	cwd: string | null;
};
const cache = new Map<string, boolean>();

function contains(value: unknown, needle: string): boolean {
	if (typeof value === "string")
		return value.toLocaleLowerCase().includes(needle);
	if (Array.isArray(value)) return value.some((item) => contains(item, needle));
	if (value && typeof value === "object")
		return Object.values(value).some((item) => contains(item, needle));
	return false;
}

/** Read the whole conversation asynchronously, including early turns and decoded JSON text.
 * Cache query results by file revision, not transcript bodies, to bound memory. */
export async function transcriptContains(
	filePath: string,
	query: string,
): Promise<boolean> {
	if (!filePath || !query.trim()) return false;
	const needle = query.trim().toLocaleLowerCase();
	try {
		const info = await stat(filePath);
		const key = `${filePath}\0${info.mtimeMs}:${info.size}\0${needle}`;
		const cached = cache.get(key);
		if (cached !== undefined) return cached;
		const stream = createReadStream(filePath, { encoding: "utf8" });
		const lines = createInterface({ input: stream, crlfDelay: Infinity });
		let found = false;
		try {
			for await (const line of lines) {
				try {
					const row = JSON.parse(line);
					// Both providers put conversational records here. Do not match arbitrary
					// session IDs, tool schemas or metadata records as remembered dialogue.
					const content =
						row.message ??
						(row.type === "response_item" || row.type === "event_msg"
							? row.payload
							: null);
					if (contains(content, needle)) {
						found = true;
						break;
					}
				} catch {
					/* A final JSONL record may still be being written. */
				}
			}
		} finally {
			lines.close();
			stream.destroy();
		}
		if (cache.size >= 800) cache.clear();
		cache.set(key, found);
		return found;
	} catch {
		return false;
	}
}

export async function searchConversations<T extends Transcript>(
	candidates: T[],
	query: string,
): Promise<T[]> {
	const needle = query.trim().toLocaleLowerCase();
	if (!needle) return [];
	const matches = new Set<string>();
	let index = 0;
	await Promise.all(
		Array.from({ length: Math.min(4, candidates.length) }, async () => {
			while (index < candidates.length) {
				const row = candidates[index++];
				if (!row) break;
				if (
					`${row.title} ${row.cwd ?? ""}`
						.toLocaleLowerCase()
						.includes(needle) ||
					(await transcriptContains(row.filePath, needle))
				)
					matches.add(row.sessionId);
			}
		}),
	);
	return candidates.filter((row) => matches.has(row.sessionId));
}
