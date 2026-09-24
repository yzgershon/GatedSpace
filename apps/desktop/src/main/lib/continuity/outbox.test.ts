import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ContinuityError,
	type PortableCheckpoint,
	type StreamHead,
} from "@superset/shared/continuity";
import { prepareCheckpoint } from "@superset/shared/continuity/client";
import { newRecoveryKey } from "@superset/shared/continuity/crypto";
import { SyncOutbox } from "./outbox";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});
function fixture() {
	const directory = mkdtempSync(join(tmpdir(), "gatedspace-outbox-test-"));
	dirs.push(directory);
	const payload: PortableCheckpoint = {
		version: 1,
		streamId: randomUUID(),
		createdAt: new Date().toISOString(),
		project: { name: "Example", gitRemote: null, gitCommit: null, files: [] },
		session: {
			provider: "codex",
			title: "Private title",
			originalId: randomUUID(),
			originalCwd: "C:/Project",
			format: "codex-rollout-v1",
			transcript: "Private transcript",
			attachments: [],
		},
	};
	const prepared = prepareCheckpoint(payload, newRecoveryKey(), "owner");
	const outbox = new SyncOutbox(directory);
	outbox.enqueue(prepared, "owner", randomUUID(), 0);
	let head: StreamHead = {
		id: payload.streamId,
		revision: 0,
		checkpointId: null,
		deviceId: null,
		leaseExpiresAt: null,
		updatedAt: payload.createdAt,
	};
	let publishCount = 0;
	let disconnected = false;
	let loseResponse = false;
	let locked = false;
	const client = {
		streams: async () => {
			if (disconnected) throw new Error("offline");
			return [head];
		},
		create: async () => head,
		acquire: async () => {
			if (locked)
				throw new ContinuityError(
					409,
					"locked",
					"Another device holds the lease",
				);
			return {
				leaseToken: "a".repeat(64),
				fence: 1,
				expiresAt: new Date(Date.now() + 120000).toISOString(),
				revision: head.revision,
			};
		},
		renew: async () => ({ expiresAt: new Date().toISOString() }),
		release: async () => {},
		publish: async () => {
			publishCount++;
			head = { ...head, revision: 1, checkpointId: prepared.id };
			if (loseResponse) throw new Error("lost response");
			return { checkpointId: prepared.id, revision: 1 };
		},
	};
	return {
		outbox,
		directory,
		prepared,
		client,
		setOffline: () => {
			disconnected = true;
		},
		setLostResponse: () => {
			loseResponse = true;
		},
		setLocked: () => {
			locked = true;
		},
		setHead: (value: StreamHead) => {
			head = value;
		},
		head: () => head,
		publishes: () => publishCount,
	};
}
test("offline upload survives process restart without plaintext and retries once", async () => {
	const f = fixture();
	f.setOffline();
	await expect(f.outbox.drain(f.client, "owner")).rejects.toThrow("offline");
	const second = new SyncOutbox(f.directory);
	expect(second.list()).toHaveLength(1);
	for (const name of readdirSync(join(f.directory, f.prepared.id)))
		expect(
			readFileSync(join(f.directory, f.prepared.id, name)).includes(
				Buffer.from("Private"),
			),
		).toBe(false);
	const client = { ...f.client, streams: async () => [f.head()] };
	expect(await second.drain(client, "owner")).toEqual({
		sent: 1,
		conflicts: [],
	});
	expect(second.list()).toHaveLength(0);
	expect(second.receipts()[0]?.revision).toBe(1);
	second.clearReceipts("owner");
	expect(readdirSync(f.directory)).toHaveLength(0);
});
test("lost commit response is acknowledged by checkpoint id without publishing twice", async () => {
	const f = fixture();
	f.setLostResponse();
	await expect(f.outbox.drain(f.client, "owner")).rejects.toThrow(
		"lost response",
	);
	expect(
		(await new SyncOutbox(f.directory).drain(f.client, "owner")).sent,
	).toBe(1);
	expect(f.publishes()).toBe(1);
});
test("revision conflicts and lease races retain local ciphertext", async () => {
	for (const locked of [false, true]) {
		const f = fixture();
		if (locked) f.setLocked();
		else f.setHead({ ...f.head(), revision: 1, checkpointId: randomUUID() });
		expect((await f.outbox.drain(f.client, "owner")).conflicts).toEqual([
			f.prepared.streamId,
		]);
		expect(f.publishes()).toBe(0);
		expect(f.outbox.list()).toHaveLength(1);
		f.outbox.hold(f.prepared.streamId, "owner");
		expect(f.outbox.list()).toHaveLength(0);
		expect(existsSync(join(f.directory, f.prepared.id, "held.json"))).toBe(
			true,
		);
	}
});
test("corrupt chunks and wrong owners cannot upload or erase queued work", async () => {
	const f = fixture();
	await expect(f.outbox.drain(f.client, "other")).rejects.toThrow(
		"another account",
	);
	const chunk = f.prepared.manifest.chunks[0];
	if (!chunk) throw new Error("missing fixture");
	writeFileSync(join(f.directory, f.prepared.id, chunk.id), "damaged");
	await expect(f.outbox.drain(f.client, "owner")).rejects.toThrow("damaged");
	expect(f.publishes()).toBe(0);
	expect(f.outbox.list()).toHaveLength(1);
});
