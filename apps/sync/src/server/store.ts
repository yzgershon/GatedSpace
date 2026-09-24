import { randomBytes } from "node:crypto";
import {
	checkpoints,
	devices,
	objects,
	quotas,
	streams,
} from "@superset/db/schema/continuity";
import {
	ContinuityError,
	LEASE_SECONDS,
	MAX_ACCOUNT_BYTES,
	type PublishCheckpoint,
	type StreamHead,
} from "@superset/shared/continuity";
import { digest } from "@superset/shared/continuity/crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { SyncDatabase } from "./auth";

type Stream = typeof streams.$inferSelect;
export interface LeaseIdentity {
	deviceId: string;
	leaseToken: string;
	fence: number;
}
const missing = () =>
	new ContinuityError(
		404,
		"not_found",
		"This item is unavailable in your account.",
	);
const conflict = (code: string, message: string) =>
	new ContinuityError(409, code, message);
export function assertLease(
	stream: Stream,
	identity: LeaseIdentity,
	now: Date,
) {
	if (
		stream.deviceId !== identity.deviceId ||
		stream.fence !== identity.fence ||
		stream.leaseHash !== digest(identity.leaseToken) ||
		!stream.leaseExpiresAt ||
		stream.leaseExpiresAt <= now
	)
		throw conflict(
			"lease_lost",
			"This PC no longer owns the session handoff. Keep your local work and reconnect.",
		);
}
function head(row: Stream): StreamHead {
	return {
		id: row.id,
		revision: row.revision,
		checkpointId: row.checkpointId,
		deviceId: row.deviceId,
		leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
		updatedAt: row.updatedAt.toISOString(),
	};
}
export function checkpointFingerprint(
	streamId: string,
	input: PublishCheckpoint,
) {
	return digest(
		JSON.stringify([
			streamId,
			input.deviceId,
			input.baseRevision,
			input.manifest,
		]),
	);
}

export class CheckpointStore {
	constructor(
		private db: SyncDatabase,
		private now = () => new Date(),
	) {}
	async register(ownerId: string, id: string, name: string) {
		await this.db
			.insert(devices)
			.values({ ownerId, id, name })
			.onConflictDoNothing();
		const [row] = await this.db
			.update(devices)
			.set({ name, updatedAt: this.now() })
			.where(
				and(
					eq(devices.id, id),
					eq(devices.ownerId, ownerId),
					eq(devices.revoked, false),
				),
			)
			.returning();
		if (!row) throw missing();
		return { id: row.id, name: row.name };
	}
	async create(ownerId: string, id: string) {
		await this.db.insert(streams).values({ ownerId, id }).onConflictDoNothing();
		const [row] = await this.db
			.select()
			.from(streams)
			.where(and(eq(streams.id, id), eq(streams.ownerId, ownerId)));
		if (!row) throw missing();
		return head(row);
	}
	async list(ownerId: string) {
		return (
			await this.db
				.select()
				.from(streams)
				.where(eq(streams.ownerId, ownerId))
				.orderBy(desc(streams.updatedAt))
				.limit(500)
		).map(head);
	}
	async acquire(
		ownerId: string,
		id: string,
		deviceId: string,
		baseRevision: number,
	) {
		return this.db.transaction(async (tx) => {
			const [device] = await tx
				.select()
				.from(devices)
				.where(
					and(
						eq(devices.id, deviceId),
						eq(devices.ownerId, ownerId),
						eq(devices.revoked, false),
					),
				);
			if (!device) throw missing();
			const [row] = await tx
				.select()
				.from(streams)
				.where(and(eq(streams.id, id), eq(streams.ownerId, ownerId)))
				.for("update");
			if (!row) throw missing();
			if (row.revision !== baseRevision)
				throw conflict(
					"revision_conflict",
					"A newer checkpoint is available. Download it before continuing, or keep this work as a separate session.",
				);
			const now = this.now();
			if (row.leaseExpiresAt && row.leaseExpiresAt > now)
				throw conflict(
					"session_in_use",
					"Another session is still active. Finish or release it before continuing here.",
				);
			const token = randomBytes(32).toString("hex"),
				expiresAt = new Date(now.getTime() + LEASE_SECONDS * 1000),
				fence = row.fence + 1;
			await tx
				.update(streams)
				.set({
					deviceId,
					leaseHash: digest(token),
					leaseExpiresAt: expiresAt,
					fence,
				})
				.where(eq(streams.id, id));
			return {
				leaseToken: token,
				fence,
				expiresAt: expiresAt.toISOString(),
				revision: row.revision,
			};
		});
	}
	async lease(
		ownerId: string,
		id: string,
		identity: LeaseIdentity,
		release: boolean,
	) {
		return this.db.transaction(async (tx) => {
			const [row] = await tx
				.select()
				.from(streams)
				.where(and(eq(streams.id, id), eq(streams.ownerId, ownerId)))
				.for("update");
			if (!row) throw missing();
			const now = this.now();
			assertLease(row, identity, now);
			const expiresAt = release
				? null
				: new Date(now.getTime() + LEASE_SECONDS * 1000);
			await tx
				.update(streams)
				.set({
					leaseExpiresAt: expiresAt,
					...(release ? { leaseHash: null } : {}),
				})
				.where(eq(streams.id, id));
			return { expiresAt: expiresAt?.toISOString() ?? null };
		});
	}
	async publish(ownerId: string, id: string, input: PublishCheckpoint) {
		return this.db.transaction(async (tx) => {
			const [row] = await tx
				.select()
				.from(streams)
				.where(and(eq(streams.id, id), eq(streams.ownerId, ownerId)))
				.for("update");
			if (!row) throw missing();
			const fingerprint = checkpointFingerprint(id, input);
			const [previous] = await tx
				.select()
				.from(checkpoints)
				.where(eq(checkpoints.id, input.id));
			if (previous) {
				if (
					previous.ownerId !== ownerId ||
					previous.streamId !== id ||
					previous.fingerprint !== fingerprint
				)
					throw conflict(
						"request_reused",
						"This checkpoint ID was already used for different work.",
					);
				return { checkpointId: previous.id, revision: previous.revision };
			}
			const now = this.now();
			assertLease(row, input, now);
			if (row.revision !== input.baseRevision)
				throw conflict(
					"revision_conflict",
					"A newer revision exists. Your local work has been kept.",
				);
			const ids = [...new Set(input.manifest.chunks.map((chunk) => chunk.id))];
			const available = new Map(
				(
					await tx
						.select()
						.from(objects)
						.where(
							and(
								eq(objects.ownerId, ownerId),
								eq(objects.ready, true),
								inArray(objects.digest, ids),
							),
						)
				).map((obj) => [obj.digest, obj.bytes]),
			);
			if (
				input.manifest.chunks.some(
					(chunk) => available.get(chunk.id) !== chunk.bytes,
				)
			)
				throw conflict(
					"incomplete_checkpoint",
					"Upload every checkpoint chunk before publishing.",
				);
			const revision = row.revision + 1;
			await tx.insert(checkpoints).values({
				id: input.id,
				ownerId,
				streamId: id,
				deviceId: input.deviceId,
				revision,
				fingerprint,
				manifest: input.manifest,
			});
			await tx
				.update(streams)
				.set({ revision, checkpointId: input.id, updatedAt: now })
				.where(eq(streams.id, id));
			return { checkpointId: input.id, revision };
		});
	}
	async checkpoint(ownerId: string, id: string) {
		const [row] = await this.db
			.select()
			.from(checkpoints)
			.where(and(eq(checkpoints.id, id), eq(checkpoints.ownerId, ownerId)));
		if (!row) throw missing();
		return {
			id: row.id,
			streamId: row.streamId,
			revision: row.revision,
			manifest: row.manifest,
		};
	}
	async reserveObject(ownerId: string, hash: string, bytes: number) {
		return this.db.transaction(async (tx) => {
			await tx.insert(quotas).values({ ownerId }).onConflictDoNothing();
			const [quota] = await tx
				.select()
				.from(quotas)
				.where(eq(quotas.ownerId, ownerId))
				.for("update");
			if (!quota) throw missing();
			const [existing] = await tx
				.select()
				.from(objects)
				.where(and(eq(objects.ownerId, ownerId), eq(objects.digest, hash)));
			if (existing) {
				if (existing.bytes !== bytes)
					throw conflict(
						"object_mismatch",
						"Stored checkpoint chunk does not match.",
					);
				return { ready: existing.ready };
			}
			if (quota.bytes + bytes > MAX_ACCOUNT_BYTES)
				throw new ContinuityError(
					413,
					"quota_exceeded",
					"This account's checkpoint storage limit has been reached. Local work is unchanged.",
				);
			await tx.insert(objects).values({ ownerId, digest: hash, bytes });
			await tx
				.update(quotas)
				.set({ bytes: sql`${quotas.bytes} + ${bytes}` })
				.where(eq(quotas.ownerId, ownerId));
			return { ready: false };
		});
	}
	async markReady(ownerId: string, hash: string) {
		await this.db
			.update(objects)
			.set({ ready: true })
			.where(and(eq(objects.ownerId, ownerId), eq(objects.digest, hash)));
	}
	async object(ownerId: string, hash: string) {
		const [row] = await this.db
			.select()
			.from(objects)
			.where(
				and(
					eq(objects.ownerId, ownerId),
					eq(objects.digest, hash),
					eq(objects.ready, true),
				),
			);
		if (!row) throw missing();
		return row;
	}
}
