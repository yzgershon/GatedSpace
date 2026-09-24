import { randomUUID } from "node:crypto";
import { z } from "zod";
import { decryptCheckpoint, digest, encryptCheckpoint } from "./crypto";
import {
	CHUNK_BYTES,
	ContinuityError,
	idSchema,
	manifestSchema,
	type PortableCheckpoint,
	SYNC_CLIENT_ID,
} from "./protocol";

export type HttpFetch = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

const revision = z.number().int().nonnegative();
const headSchema = z.object({
	id: idSchema,
	revision,
	checkpointId: idSchema.nullable(),
	deviceId: idSchema.nullable(),
	leaseExpiresAt: z.string().datetime().nullable(),
	updatedAt: z.string().datetime(),
});
export const leaseSchema = z.object({
	leaseToken: z.string().regex(/^[a-f0-9]{64}$/),
	fence: z.number().int().positive(),
	expiresAt: z.string().datetime(),
	revision,
});
export type CheckpointLease = z.infer<typeof leaseSchema>;
export type PreparedCheckpoint = ReturnType<typeof prepareCheckpoint>;

export function syncOrigin(value: string) {
	const url = new URL(value);
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.pathname !== "/"
	)
		throw new Error("Use the HTTPS address of your GatedSpace sync service.");
	return url.origin;
}
export function prepareCheckpoint(
	payload: PortableCheckpoint,
	recoveryKey: string,
	ownerId: string,
) {
	const id: string = randomUUID();
	return {
		id,
		streamId: payload.streamId,
		...encryptCheckpoint(payload, recoveryKey, ownerId, id),
	};
}

export class ContinuityClient {
	readonly origin: string;
	constructor(
		origin: string,
		private token: string,
		private fetcher: HttpFetch = fetch,
	) {
		this.origin = syncOrigin(origin);
	}
	private async request(
		path: string,
		method = "GET",
		body?: unknown | Uint8Array,
	) {
		const response = await this.fetcher(`${this.origin}/api/v1/${path}`, {
			method,
			redirect: "error",
			signal: AbortSignal.timeout(30_000),
			headers: {
				Authorization: `Bearer ${this.token}`,
				...(body
					? {
							"Content-Type":
								body instanceof Uint8Array
									? "application/octet-stream"
									: "application/json",
						}
					: {}),
			},
			body:
				body instanceof Uint8Array
					? Buffer.from(body)
					: body
						? JSON.stringify(body)
						: undefined,
		});
		if (!response.ok) {
			const result = await response.json().catch(() => ({}));
			const error = z
				.object({ error: z.string().max(1000), code: z.string().max(100) })
				.safeParse(result);
			throw new ContinuityError(
				response.status,
				error.success ? error.data.code : "unavailable",
				error.success
					? error.data.error
					: "Cannot reach GatedSpace Sync. Your local work is unchanged.",
			);
		}
		return response;
	}
	async account() {
		return z
			.object({ id: z.string(), email: z.email() })
			.parse(await (await this.request("me")).json());
	}
	async register(deviceId: string, name: string) {
		await this.request(`devices/${idSchema.parse(deviceId)}`, "PUT", { name });
	}
	async streams() {
		return z
			.object({ streams: z.array(headSchema) })
			.parse(await (await this.request("streams")).json()).streams;
	}
	async create(streamId: string) {
		return headSchema.parse(
			await (
				await this.request(`streams/${idSchema.parse(streamId)}`, "POST")
			).json(),
		);
	}
	async acquire(streamId: string, deviceId: string, baseRevision: number) {
		return leaseSchema.parse(
			await (
				await this.request(
					`streams/${idSchema.parse(streamId)}/lease`,
					"POST",
					{ deviceId, baseRevision },
				)
			).json(),
		);
	}
	async renew(streamId: string, deviceId: string, lease: CheckpointLease) {
		return z
			.object({ expiresAt: z.string().datetime() })
			.parse(
				await (
					await this.request(
						`streams/${idSchema.parse(streamId)}/lease`,
						"PATCH",
						{ deviceId, leaseToken: lease.leaseToken, fence: lease.fence },
					)
				).json(),
			);
	}
	async release(streamId: string, deviceId: string, lease: CheckpointLease) {
		await this.request(`streams/${idSchema.parse(streamId)}/lease`, "DELETE", {
			deviceId,
			leaseToken: lease.leaseToken,
			fence: lease.fence,
		});
	}
	async publish(
		prepared: PreparedCheckpoint,
		deviceId: string,
		baseRevision: number,
		lease: CheckpointLease,
		beforeChunk?: () => Promise<void>,
	) {
		// Sequential, bounded uploads avoid a burst on battery-powered devices.
		for (const chunk of prepared.chunks) {
			await beforeChunk?.();
			await this.request(`objects/${digest(chunk)}`, "PUT", chunk);
		}
		await beforeChunk?.();
		return z.object({ checkpointId: idSchema, revision }).parse(
			await (
				await this.request(`streams/${prepared.streamId}/checkpoints`, "POST", {
					id: prepared.id,
					deviceId,
					baseRevision,
					leaseToken: lease.leaseToken,
					fence: lease.fence,
					manifest: prepared.manifest,
				})
			).json(),
		);
	}
	async download(
		checkpointId: string,
		streamId: string,
		ownerId: string,
		recoveryKey: string,
	) {
		const checkpoint = z
			.object({
				id: idSchema,
				streamId: idSchema,
				revision,
				manifest: manifestSchema,
			})
			.parse(
				await (
					await this.request(`checkpoints/${idSchema.parse(checkpointId)}`)
				).json(),
			);
		if (checkpoint.id !== checkpointId || checkpoint.streamId !== streamId)
			throw new Error("Received a checkpoint for a different session.");
		const chunks: Uint8Array[] = [];
		for (const chunk of checkpoint.manifest.chunks) {
			const response = await this.request(`objects/${chunk.id}`);
			const reader = response.body?.getReader();
			if (!reader) throw new Error("Checkpoint is incomplete.");
			const parts: Uint8Array[] = [];
			let size = 0;
			try {
				while (true) {
					const next = await reader.read();
					if (next.done) break;
					size += next.value.length;
					if (size > chunk.bytes || size > CHUNK_BYTES + 29) {
						await reader.cancel();
						throw new Error("Checkpoint chunk exceeds the expected size.");
					}
					parts.push(next.value);
				}
			} finally {
				reader.releaseLock();
			}
			chunks.push(Buffer.concat(parts));
		}
		return {
			revision: checkpoint.revision,
			payload: decryptCheckpoint(
				checkpoint.manifest,
				chunks,
				recoveryKey,
				ownerId,
				streamId,
				checkpointId,
			),
		};
	}
}

export async function startDeviceSignIn(
	originInput: string,
	fetcher: HttpFetch = fetch,
) {
	const origin = syncOrigin(originInput);
	const response = await fetcher(`${origin}/api/auth/device/code`, {
		method: "POST",
		redirect: "error",
		signal: AbortSignal.timeout(15_000),
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ client_id: SYNC_CLIENT_ID }),
	});
	if (!response.ok)
		throw new Error(
			"The sync sign-in service is not ready. Check its setup first.",
		);
	const value = z
		.object({
			device_code: z.string().min(16).max(1024),
			user_code: z.string().min(4).max(30),
			verification_uri: z.url(),
			expires_in: z.number().int().positive().max(1800),
			interval: z.number().int().min(1).max(60),
		})
		.parse(await response.json());
	if (new URL(value.verification_uri).origin !== origin)
		throw new Error("Sign-in returned an unexpected service address.");
	return {
		...value,
		url: `${origin}/device?user_code=${encodeURIComponent(value.user_code)}`,
	};
}
