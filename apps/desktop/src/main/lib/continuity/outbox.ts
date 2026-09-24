import {
	existsSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmdirSync,
	unlinkSync,
} from "node:fs";
import { join } from "node:path";
import {
	ContinuityError,
	idSchema,
	MAX_ACCOUNT_BYTES,
	manifestSchema,
} from "@superset/shared/continuity";
import type {
	ContinuityClient,
	PreparedCheckpoint,
} from "@superset/shared/continuity/client";
import { digest } from "@superset/shared/continuity/crypto";
import { z } from "zod";
import { ensureSecureDir, writeSecureFile } from "../secure-file/secure-file";

const pendingSchema = z.object({
	id: idSchema,
	streamId: idSchema,
	ownerId: z.string().min(1),
	deviceId: idSchema,
	baseRevision: z.number().int().nonnegative(),
	manifest: manifestSchema,
});
type Pending = z.infer<typeof pendingSchema>;
type UploadClient = Pick<
	ContinuityClient,
	"streams" | "create" | "acquire" | "publish" | "renew" | "release"
>;

/** Contains ciphertext only. A manifest is published last so incomplete writes cannot upload. */
export class SyncOutbox {
	private draining: Promise<{ sent: number; conflicts: string[] }> | null =
		null;
	constructor(readonly directory: string) {}
	list(): Pending[] {
		if (!existsSync(this.directory)) return [];
		return readdirSync(this.directory)
			.filter((name) => idSchema.safeParse(name).success)
			.flatMap((name) => {
				const path = join(this.directory, name, "pending.json");
				if (
					!existsSync(path) ||
					existsSync(join(this.directory, name, "sent.json"))
				)
					return [];
				const parsed = pendingSchema.parse(
					JSON.parse(readFileSync(path, "utf8")),
				);
				if (parsed.id !== name)
					throw new Error(
						"A queued checkpoint is inconsistent. Its files have been preserved.",
					);
				return [parsed];
			});
	}
	enqueue(
		prepared: PreparedCheckpoint,
		ownerId: string,
		deviceId: string,
		baseRevision: number,
	) {
		const row = pendingSchema.parse({
			...prepared,
			chunks: undefined,
			ownerId,
			deviceId,
			baseRevision,
		});
		const queued = this.list();
		if (queued.some((item) => item.streamId === row.streamId))
			throw new Error(
				"This conversation already has a queued checkpoint. Send it before making another.",
			);
		const bytes = [...queued, row].reduce(
			(total, item) =>
				total +
				item.manifest.chunks.reduce((sum, chunk) => sum + chunk.bytes, 0),
			0,
		);
		if (bytes > MAX_ACCOUNT_BYTES)
			throw new Error(
				"The local Sync queue is full. Finish pending transfers first.",
			);
		const path = join(this.directory, row.id);
		ensureSecureDir(path);
		for (const [index, chunk] of row.manifest.chunks.entries()) {
			const content = prepared.chunks[index];
			if (
				!content ||
				digest(content) !== chunk.id ||
				content.length !== chunk.bytes
			)
				throw new Error("Checkpoint data is incomplete.");
			writeSecureFile(join(path, chunk.id), content);
		}
		writeSecureFile(join(path, "pending.tmp"), JSON.stringify(row));
		renameSync(join(path, "pending.tmp"), join(path, "pending.json"));
	}
	private prepared(row: Pending): PreparedCheckpoint {
		const chunks = row.manifest.chunks.map((part) => {
			const data = readFileSync(join(this.directory, row.id, part.id));
			if (data.length !== part.bytes || digest(data) !== part.id)
				throw new Error(
					"A queued checkpoint is damaged. Nothing was uploaded or removed.",
				);
			return data;
		});
		return {
			id: row.id,
			streamId: row.streamId,
			manifest: row.manifest,
			chunks,
		};
	}
	receipts() {
		if (!existsSync(this.directory)) return [];
		return readdirSync(this.directory)
			.filter((name) => idSchema.safeParse(name).success)
			.flatMap((name) => {
				const path = join(this.directory, name, "sent.json");
				if (!existsSync(path)) return [];
				const row = pendingSchema
					.extend({ revision: z.number().int().positive() })
					.parse(JSON.parse(readFileSync(path, "utf8")));
				if (row.id !== name)
					throw new Error(
						"A checkpoint receipt is inconsistent. Its files were preserved.",
					);
				return [row];
			});
	}
	clearReceipts(ownerId: string) {
		for (const row of this.receipts().filter(
			(row) => row.ownerId === ownerId,
		)) {
			const dir = join(this.directory, row.id);
			// These are explicit digest-named files inside this checkpoint only.
			for (const chunk of row.manifest.chunks)
				if (existsSync(join(dir, chunk.id))) unlinkSync(join(dir, chunk.id));
			if (existsSync(join(dir, "pending.json")))
				unlinkSync(join(dir, "pending.json"));
			unlinkSync(join(dir, "sent.json"));
			if (readdirSync(dir).length === 0) rmdirSync(dir);
		}
	}
	/** Retain an old local version when the user restores the remote one. */
	hold(streamId: string, ownerId: string) {
		for (const row of this.list().filter(
			(row) => row.streamId === streamId && row.ownerId === ownerId,
		)) {
			const dir = join(this.directory, row.id);
			renameSync(join(dir, "pending.json"), join(dir, "held.json"));
		}
	}
	private acknowledge(row: Pending, revision: number) {
		// Move the manifest first; a crash during cleanup cannot replay an acknowledged job.
		const dir = join(this.directory, row.id);
		writeSecureFile(
			join(dir, "sent.tmp"),
			JSON.stringify({ ...row, revision }),
		);
		renameSync(join(dir, "sent.tmp"), join(dir, "sent.json"));
		if (existsSync(join(dir, "pending.json")))
			unlinkSync(join(dir, "pending.json"));
	}
	drain(client: UploadClient, ownerId: string) {
		if (this.draining) return this.draining;
		this.draining = this.flush(client, ownerId).finally(() => {
			this.draining = null;
		});
		return this.draining;
	}
	private async flush(client: UploadClient, ownerId: string) {
		let sent = 0;
		const conflicts: string[] = [];
		for (const row of this.list()) {
			if (row.ownerId !== ownerId)
				throw new Error(
					"Queued work belongs to another account. Reconnect that account to continue.",
				);
			const prepared = this.prepared(row);
			const head =
				(await client.streams()).find((stream) => stream.id === row.streamId) ??
				(await client.create(row.streamId));
			// The previous request may have committed while its response was lost.
			if (head.checkpointId === row.id) {
				this.acknowledge(row, head.revision);
				sent++;
				continue;
			}
			if (head.revision !== row.baseRevision) {
				conflicts.push(row.streamId);
				continue;
			}
			let lease: Awaited<ReturnType<UploadClient["acquire"]>> | undefined;
			let renewedAt = Date.now();
			try {
				lease = await client.acquire(
					row.streamId,
					row.deviceId,
					row.baseRevision,
				);
				const activeLease = lease;
				const published = await client.publish(
					prepared,
					row.deviceId,
					row.baseRevision,
					lease,
					async () => {
						if (Date.now() - renewedAt > 40_000) {
							await client.renew(row.streamId, row.deviceId, activeLease);
							renewedAt = Date.now();
						}
					},
				);
				this.acknowledge(row, published.revision);
				sent++;
			} catch (error) {
				if (error instanceof ContinuityError && error.status === 409)
					conflicts.push(row.streamId);
				else throw error;
			} finally {
				if (lease)
					await client
						.release(row.streamId, row.deviceId, lease)
						.catch(() => {});
			}
		}
		return { sent, conflicts };
	}
}
