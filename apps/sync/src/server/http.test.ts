import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
	CHUNK_BYTES,
	ContinuityError,
	type PortableCheckpoint,
} from "@superset/shared/continuity";
import {
	ContinuityClient,
	prepareCheckpoint,
	startDeviceSignIn,
	syncOrigin,
} from "@superset/shared/continuity/client";
import { digest, newRecoveryKey } from "@superset/shared/continuity/crypto";
import { createSyncHandler, type ServiceDependencies } from "./http";

function fixture() {
	const blobs = new Map<string, Uint8Array>();
	const objects = new Map<
		string,
		{
			ownerId: string;
			digest: string;
			bytes: number;
			ready: boolean;
			createdAt: Date;
		}
	>();
	const snapshots = new Map<
		string,
		Awaited<ReturnType<ServiceDependencies["store"]["checkpoint"]>> & {
			ownerId: string;
		}
	>();
	let writes = 0,
		failUpload = false,
		failQuota = false;
	const deps: ServiceDependencies = {
		authenticate: async (request) =>
			request.headers.get("authorization") === "Bearer owner"
				? { id: "owner", email: "owner@example.test" }
				: request.headers.get("authorization") === "Bearer other"
					? { id: "other", email: "other@example.test" }
					: null,
		blobs: {
			async put(owner, id, bytes) {
				if (failUpload)
					throw new Error("private storage credential should never be exposed");
				writes++;
				blobs.set(`${owner}/${id}`, bytes);
			},
			async get(owner, id) {
				const bytes = blobs.get(`${owner}/${id}`);
				return bytes ? new Response(Buffer.from(bytes)).body : null;
			},
		},
		store: {
			register: async (_owner, id, name) => ({ id, name }),
			create: async (_owner, id) => ({
				id,
				revision: 0,
				checkpointId: null,
				deviceId: null,
				leaseExpiresAt: null,
				updatedAt: new Date().toISOString(),
			}),
			list: async () => [],
			acquire: async (_owner, _id, _deviceId, baseRevision) => ({
				leaseToken: "a".repeat(64),
				fence: 1,
				expiresAt: new Date(Date.now() + 120_000).toISOString(),
				revision: baseRevision,
			}),
			lease: async (_owner, _id, _identity, release) => ({
				expiresAt: release
					? null
					: new Date(Date.now() + 120_000).toISOString(),
			}),
			publish: async (ownerId, streamId, input) => {
				snapshots.set(input.id, {
					ownerId,
					id: input.id,
					streamId,
					revision: input.baseRevision + 1,
					manifest: input.manifest,
				});
				return { checkpointId: input.id, revision: input.baseRevision + 1 };
			},
			checkpoint: async (owner, id) => {
				const row = snapshots.get(id);
				if (!row || row.ownerId !== owner)
					throw new ContinuityError(404, "not_found", "Unavailable");
				return row;
			},
			reserveObject: async (ownerId, id, bytes) => {
				if (failQuota)
					throw new ContinuityError(
						413,
						"quota_exceeded",
						"Storage limit reached",
					);
				const key = `${ownerId}/${id}`,
					prior = objects.get(key);
				if (prior) return { ready: prior.ready };
				objects.set(key, {
					ownerId,
					digest: id,
					bytes,
					ready: false,
					createdAt: new Date(),
				});
				return { ready: false };
			},
			markReady: async (owner, id) => {
				const row = objects.get(`${owner}/${id}`);
				if (row) row.ready = true;
			},
			object: async (owner, id) => {
				const row = objects.get(`${owner}/${id}`);
				if (!row?.ready)
					throw new ContinuityError(404, "not_found", "Unavailable");
				return row;
			},
		},
	};
	const handler = createSyncHandler(deps);
	const fetcher = ((url, init) =>
		handler(new Request(url, init))) as typeof fetch;
	return {
		handler,
		fetcher,
		objects,
		blobs,
		writes: () => writes,
		failUpload: (value: boolean) => {
			failUpload = value;
		},
		failQuota: () => {
			failQuota = true;
		},
	};
}

describe("sync HTTP boundary and desktop transport", () => {
	test("round trips an encrypted multi-chunk session to a second PC; retries reuse uploaded objects", async () => {
		const app = fixture(),
			key = newRecoveryKey(),
			streamId = randomUUID(),
			deviceId = randomUUID();
		const payload: PortableCheckpoint = {
			version: 1,
			streamId,
			createdAt: new Date().toISOString(),
			project: {
				name: "Selected project",
				gitRemote: null,
				gitCommit: null,
				files: [],
			},
			session: {
				provider: "codex",
				title: "A task",
				originalId: randomUUID(),
				originalCwd: "C:\\Example",
				format: "codex-rollout-v1",
				transcript: "line of conversation\n".repeat(40_000),
				attachments: [],
			},
		};
		const laptop = new ContinuityClient(
			"https://sync.example.test",
			"owner",
			app.fetcher,
		);
		const omen = new ContinuityClient(
			"https://sync.example.test",
			"owner",
			app.fetcher,
		);
		expect((await laptop.account()).id).toBe("owner");
		await laptop.register(deviceId, "Laptop");
		await laptop.create(streamId);
		const lease = await laptop.acquire(streamId, deviceId, 0);
		const prepared = prepareCheckpoint(payload, key, "owner");
		const published = await laptop.publish(prepared, deviceId, 0, lease);
		await laptop.publish(prepared, deviceId, 0, lease);
		expect(app.writes()).toBe(prepared.chunks.length);
		await laptop.release(streamId, deviceId, lease);
		expect(
			(await omen.download(published.checkpointId, streamId, "owner", key))
				.payload,
		).toEqual(payload);
		const other = new ContinuityClient(
			"https://sync.example.test",
			"other",
			app.fetcher,
		);
		await expect(
			other.download(published.checkpointId, streamId, "other", key),
		).rejects.toThrow("Unavailable");
	});
	test("cookies, missing and invalid bearer credentials cannot read or upload data", async () => {
		const app = fixture();
		const attempts: HeadersInit[] = [
			{},
			{ cookie: "session=owner" },
			{ authorization: "Bearer invalid" },
		];
		for (const headers of attempts) {
			const response = await app.handler(
				new Request("https://sync.example.test/api/v1/streams", { headers }),
			);
			expect(response.status).toBe(401);
			expect(response.headers.get("cache-control")).toBe("private, no-store");
		}
		expect(app.writes()).toBe(0);
	});
	test("failed storage write stays pending and retry completes without leaking secrets", async () => {
		const app = fixture(),
			bytes = Buffer.concat([Buffer.from([1]), Buffer.alloc(40)]),
			id = digest(bytes);
		const put = () =>
			app.handler(
				new Request(`https://sync.example.test/api/v1/objects/${id}`, {
					method: "PUT",
					headers: { authorization: "Bearer owner" },
					body: bytes,
				}),
			);
		app.failUpload(true);
		const failed = await put();
		expect(failed.status).toBe(503);
		expect(await failed.text()).not.toContain("credential");
		expect(app.objects.get(`owner/${id}`)?.ready).toBe(false);
		app.failUpload(false);
		expect((await put()).status).toBe(200);
		expect(app.objects.size).toBe(1);
		expect(app.objects.get(`owner/${id}`)?.ready).toBe(true);
	});
	test("rejects bad hashes and oversized streaming bodies before quota reservation", async () => {
		const app = fixture();
		for (const bytes of [
			Buffer.from([1, 2, 3]),
			Buffer.alloc(CHUNK_BYTES + 30, 1),
		]) {
			const response = await app.handler(
				new Request(
					`https://sync.example.test/api/v1/objects/${"a".repeat(64)}`,
					{
						method: "PUT",
						headers: { authorization: "Bearer owner" },
						body: bytes,
					},
				),
			);
			expect([400, 413]).toContain(response.status);
		}
		expect(app.objects.size).toBe(0);
	});
	test("account quota rejection never writes a blob", async () => {
		const app = fixture();
		app.failQuota();
		const bytes = Buffer.alloc(40, 1);
		const response = await app.handler(
			new Request(`https://sync.example.test/api/v1/objects/${digest(bytes)}`, {
				method: "PUT",
				headers: { authorization: "Bearer owner" },
				body: bytes,
			}),
		);
		expect(response.status).toBe(413);
		expect(app.writes()).toBe(0);
	});
	test("client rejects credential-bearing origins and cross-origin sign-in URLs", async () => {
		for (const origin of [
			"http://example.test",
			"https://user:secret@example.test",
			"https://example.test/path",
			"https://example.test/?token=secret",
		])
			expect(() => syncOrigin(origin)).toThrow();
		const fetcher = async () =>
			Response.json({
				device_code: "a".repeat(32),
				user_code: "ABCD1234",
				verification_uri: "https://elsewhere.test/device",
				expires_in: 600,
				interval: 5,
			});
		await expect(
			startDeviceSignIn("https://sync.example.test", fetcher),
		).rejects.toThrow("unexpected service");
	});
});
