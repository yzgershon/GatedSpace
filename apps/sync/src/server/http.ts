import {
	CHUNK_BYTES,
	ContinuityError,
	digestSchema,
	idSchema,
	publishSchema,
} from "@superset/shared/continuity";
import { digest } from "@superset/shared/continuity/crypto";
import { z } from "zod";
import type { CheckpointStore } from "./store";

export interface BlobStorage {
	put(ownerId: string, id: string, data: Uint8Array): Promise<void>;
	get(ownerId: string, id: string): Promise<ReadableStream | null>;
}
export interface SyncPrincipal {
	id: string;
	email: string;
}
export interface ServiceDependencies {
	store: Pick<
		CheckpointStore,
		| "register"
		| "create"
		| "list"
		| "acquire"
		| "lease"
		| "publish"
		| "checkpoint"
		| "reserveObject"
		| "markReady"
		| "object"
	>;
	blobs: BlobStorage;
	authenticate(request: Request): Promise<SyncPrincipal | null>;
}
export async function boundedBody(
	request: Request,
	maximum: number,
): Promise<Uint8Array> {
	const reader = request.body?.getReader();
	if (!reader)
		throw new ContinuityError(400, "empty_body", "Request body is missing.");
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			size += next.value.length;
			if (size > maximum) {
				await reader.cancel();
				throw new ContinuityError(
					413,
					"too_large",
					"Request exceeds the size limit.",
				);
			}
			chunks.push(next.value);
		}
	} finally {
		reader.releaseLock();
	}
	return Buffer.concat(chunks);
}
async function json(request: Request) {
	return JSON.parse(
		Buffer.from(await boundedBody(request, 256 * 1024)).toString("utf8"),
	) as unknown;
}
const leaseSchema = z
	.object({
		deviceId: idSchema,
		leaseToken: z.string().regex(/^[a-f0-9]{64}$/),
		fence: z.number().int().positive(),
	})
	.strict();
const headers = {
	"Cache-Control": "private, no-store",
	"X-Content-Type-Options": "nosniff",
};

export function createSyncHandler(deps: ServiceDependencies) {
	return async (request: Request): Promise<Response> => {
		try {
			// Sync API uses bearer credentials only; a browser cookie cannot authorize a write.
			if (!/^Bearer [^\s]+$/.test(request.headers.get("authorization") ?? ""))
				return Response.json(
					{ error: "Sign in to GatedSpace Sync.", code: "unauthorized" },
					{ status: 401, headers },
				);
			const user = await deps.authenticate(request);
			if (!user)
				return Response.json(
					{ error: "Your sync sign-in has expired.", code: "unauthorized" },
					{ status: 401, headers },
				);
			const path = new URL(request.url).pathname
				.replace(/^\/api\/v1\/?/, "")
				.split("/");
			const [kind, rawId, action] = path;
			if (path.length > 3)
				throw new ContinuityError(404, "not_found", "Unknown sync endpoint.");
			const method = request.method;
			let result: unknown;
			if (kind === "me" && !rawId && method === "GET") result = user;
			else if (kind === "devices" && rawId && !action && method === "PUT") {
				const { name } = z
					.object({ name: z.string().trim().min(1).max(100) })
					.strict()
					.parse(await json(request));
				result = await deps.store.register(
					user.id,
					idSchema.parse(rawId),
					name,
				);
			} else if (kind === "streams" && !rawId && method === "GET")
				result = { streams: await deps.store.list(user.id) };
			else if (kind === "streams" && rawId) {
				const id = idSchema.parse(rawId);
				if (!action && method === "POST")
					result = await deps.store.create(user.id, id);
				else if (action === "lease" && method === "POST") {
					const input = z
						.object({
							deviceId: idSchema,
							baseRevision: z.number().int().nonnegative(),
						})
						.strict()
						.parse(await json(request));
					result = await deps.store.acquire(
						user.id,
						id,
						input.deviceId,
						input.baseRevision,
					);
				} else if (
					action === "lease" &&
					(method === "PATCH" || method === "DELETE")
				)
					result = await deps.store.lease(
						user.id,
						id,
						leaseSchema.parse(await json(request)),
						method === "DELETE",
					);
				else if (action === "checkpoints" && method === "POST")
					result = await deps.store.publish(
						user.id,
						id,
						publishSchema.parse(await json(request)),
					);
			} else if (kind === "checkpoints" && rawId && !action && method === "GET")
				result = await deps.store.checkpoint(user.id, idSchema.parse(rawId));
			else if (kind === "objects" && rawId && !action) {
				const id = digestSchema.parse(rawId);
				if (method === "PUT") {
					const data = await boundedBody(request, CHUNK_BYTES + 29);
					if (data.length < 29 || data[0] !== 1 || digest(data) !== id)
						throw new ContinuityError(
							400,
							"invalid_chunk",
							"Checkpoint chunk failed its integrity check.",
						);
					const stored = await deps.store.reserveObject(
						user.id,
						id,
						data.length,
					);
					if (!stored.ready) {
						await deps.blobs.put(user.id, id, data);
						await deps.store.markReady(user.id, id);
					}
					result = { id };
				} else if (method === "GET") {
					const object = await deps.store.object(user.id, id);
					const stream = await deps.blobs.get(user.id, id);
					if (!stream)
						throw new ContinuityError(
							503,
							"storage_unavailable",
							"This checkpoint chunk is temporarily unavailable.",
						);
					return new Response(stream, {
						headers: {
							...headers,
							"Content-Type": "application/octet-stream",
							"Content-Length": String(object.bytes),
						},
					});
				}
			}
			if (result === undefined)
				throw new ContinuityError(404, "not_found", "Unknown sync endpoint.");
			return Response.json(result, { headers });
		} catch (error) {
			if (error instanceof ContinuityError)
				return Response.json(
					{ error: error.message, code: error.code },
					{ status: error.status, headers },
				);
			if (error instanceof z.ZodError || error instanceof SyntaxError)
				return Response.json(
					{ error: "Invalid sync request.", code: "invalid_request" },
					{ status: 400, headers },
				);
			console.error(
				"[sync] Request failed",
				error instanceof Error ? error.name : "UnknownError",
			);
			return Response.json(
				{
					error:
						"Sync is temporarily unavailable. Your local work is unchanged.",
					code: "unavailable",
				},
				{ status: 503, headers },
			);
		}
	};
}
