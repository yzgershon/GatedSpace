import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

const entry = z.object({
	sessionId: z.string().uuid(),
	title: z.string().trim().min(1).max(120),
	cwd: z.string().nullable(),
	lastModified: z.number().finite(),
});
export type PinnedCodexSession = z.infer<typeof entry>;

/** Bookmarks only. The Codex-owned rollout remains the sole conversation history. */
export class PinnedCodexSessions {
	constructor(private readonly file: string) {}
	read(): PinnedCodexSession[] {
		try {
			return z
				.array(entry)
				.max(100)
				.parse(JSON.parse(readFileSync(this.file, "utf8")));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw new Error(
				"Could not read pinned Codex sessions. The saved file has been preserved.",
			);
		}
	}
	set(session: PinnedCodexSession, pinned: boolean) {
		const valid = entry.parse(session);
		const rows = this.read().filter((row) => row.sessionId !== valid.sessionId);
		if (pinned) rows.push(valid);
		if (rows.length > 100)
			throw new Error("You can pin up to 100 Codex sessions.");
		mkdirSync(dirname(this.file), { recursive: true });
		const temp = `${this.file}.${process.pid}.tmp`;
		writeFileSync(temp, JSON.stringify(rows, null, 2), "utf8");
		renameSync(temp, this.file);
	}
}

export function mergePinnedCodexSessions<T extends PinnedCodexSession>(
	recent: T[],
	pinned: PinnedCodexSession[],
	search = "",
) {
	const query = search.trim().toLowerCase();
	const pinnedIds = new Set(pinned.map((row) => row.sessionId));
	return [
		...pinned
			.map((row) => ({
				...row,
				...recent.find((item) => item.sessionId === row.sessionId),
				// Imported names are deliberate, not the raw first prompt from state.db.
				title: row.title,
				pinned: true,
			}))
			.filter(
				(row) =>
					!query ||
					`${row.title} ${row.cwd ?? ""}`.toLowerCase().includes(query),
			),
		...recent
			.filter((row) => !pinnedIds.has(row.sessionId))
			.map((row) => ({ ...row, pinned: false })),
	];
}
