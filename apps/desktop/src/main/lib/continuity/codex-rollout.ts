import { open } from "node:fs/promises";
import { z } from "zod";

const MAX_TRANSCRIPT = 128 * 1024 * 1024;
const rowSchema = z
	.object({
		type: z.string(),
		payload: z.record(z.string(), z.unknown()),
		ordinal: z.number().int().nonnegative().optional(),
	})
	.passthrough();
const baseSchema = z.object({
	thread_id: z.uuid(),
	end_ordinal_exclusive: z.number().int().positive(),
	end_byte_offset: z.number().int().positive().max(MAX_TRANSCRIPT),
});
type Row = z.infer<typeof rowSchema>;

async function readRows(path: string, bytes?: number) {
	const handle = await open(path, "r");
	try {
		const before = await handle.stat();
		const length = bytes ?? before.size;
		if (!before.isFile() || length > MAX_TRANSCRIPT || length > before.size)
			throw new Error(
				"Codex history exceeds the transfer limit or is incomplete.",
			);
		const buffer = Buffer.alloc(length);
		let offset = 0;
		while (offset < length) {
			const next = await handle.read(buffer, offset, length - offset, offset);
			if (!next.bytesRead) break;
			offset += next.bytesRead;
		}
		const after = await handle.stat();
		if (
			offset !== length ||
			(!bytes &&
				(before.size !== after.size || before.mtimeMs !== after.mtimeMs))
		)
			throw new Error(
				"Codex history changed during export. Wait for the task to finish.",
			);
		if (buffer[length - 1] !== 10)
			throw new Error(
				"Codex history is still being written. Retry when the session is idle.",
			);
		return buffer
			.toString("utf8")
			.split("\n")
			.filter(Boolean)
			.map((line) => rowSchema.parse(JSON.parse(line)));
	} finally {
		await handle.close();
	}
}

/** Materialize inherited paginated history, with strict parent bounds and cycle limits. */
export async function exportCodexRollout(
	path: string,
	resolveParent: (id: string) => string | null,
) {
	const seen = new Set<string>();
	let total = 0;
	async function collect(file: string, bytes?: number): Promise<Row[]> {
		if (seen.has(file) || seen.size >= 64)
			throw new Error("Codex history contains a cycle or too many parents.");
		seen.add(file);
		const rows = await readRows(file, bytes);
		const meta = rows[0];
		if (meta?.type !== "session_meta")
			throw new Error("Unsupported Codex transcript format.");
		total += Buffer.byteLength(JSON.stringify(rows));
		if (total > MAX_TRANSCRIPT)
			throw new Error("Combined Codex history exceeds the transfer limit.");
		let parents: Row[] = [];
		if (meta.payload.history_base) {
			const base = baseSchema.parse(meta.payload.history_base);
			const parent = resolveParent(base.thread_id);
			if (!parent)
				throw new Error(
					"An earlier part of this Codex conversation is missing. Sync was stopped to preserve context.",
				);
			const inherited = (await collect(parent, base.end_byte_offset)).filter(
				(row) => row.type !== "session_meta",
			);
			if (inherited.some((row) => row.ordinal === undefined))
				throw new Error(
					"An inherited Codex transcript has no history ordinals. Sync stopped to avoid losing context.",
				);
			parents = inherited.filter(
				(row) =>
					row.type !== "session_meta" &&
					row.ordinal !== undefined &&
					row.ordinal < base.end_ordinal_exclusive,
			);
		}
		return [
			meta,
			...parents,
			...rows.slice(1).filter((row) => row.type !== "session_meta"),
		];
	}
	const rows = await collect(path);
	const first = rows[0];
	if (!first) throw new Error("Empty Codex transcript.");
	delete first.payload.history_base;
	delete first.payload.forked_from_id;
	delete first.payload.forked_from_ordinal_exclusive;
	// Paginated history also relies on a per-profile projection database. A
	// self-contained transfer uses Codex's supported legacy replay instead of
	// copying that live database or importing cloud-only in-memory history.
	first.payload.history_mode = "legacy";
	return `${rows.map((row, ordinal) => JSON.stringify({ ...row, ordinal })).join("\n")}\n`;
}

/** A new native ID isolates the imported conversation from the source machine. */
export function retargetCodexRollout(
	transcript: string,
	id: string,
	cwd: string,
) {
	z.uuid().parse(id);
	const rows = transcript
		.trimEnd()
		.split("\n")
		.map((line) => rowSchema.parse(JSON.parse(line)));
	if (rows[0]?.type !== "session_meta" || rows[0].payload.history_base)
		throw new Error(
			"The checkpoint is not a self-contained Codex conversation.",
		);
	for (const row of rows) {
		if (row.type === "session_meta") {
			row.payload.id = id;
			row.payload.session_id = id;
			row.payload.cwd = cwd;
			row.payload.runtime_workspace_roots = [cwd];
		}
		if (row.type === "turn_context") {
			row.payload.cwd = cwd;
			row.payload.runtime_workspace_roots = [cwd];
			if (row.payload.workspace_roots) row.payload.workspace_roots = [cwd];
		}
		if (
			row.type === "event_msg" &&
			row.payload.type === "thread_settings_applied"
		) {
			row.payload.thread_id = id;
			const settings = row.payload.thread_settings;
			if (settings && typeof settings === "object")
				Object.assign(settings, { cwd, runtime_workspace_roots: [cwd] });
		}
	}
	return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}
