import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	PortableCheckpoint,
	StreamHead,
} from "@superset/shared/continuity";
import {
	ContinuityClient,
	type PreparedCheckpoint,
} from "@superset/shared/continuity/client";
import {
	decryptCheckpoint,
	newRecoveryKey,
} from "@superset/shared/continuity/crypto";
import { SyncConnection } from "./connection";
import { collectProject, restoreProject } from "./project-files";
import { testStorage } from "./test-storage";
import { SyncTransfers } from "./transfers";
import { SyncVault } from "./vault";

const dirs: string[] = [];
afterEach(async () => {
	for (const dir of dirs.splice(0))
		await rm(dir, { recursive: true, force: true });
});
class FixtureClient extends ContinuityClient {
	heads = new Map<string, StreamHead>();
	checkpoints = new Map<
		string,
		{ prepared: PreparedCheckpoint; revision: number }
	>();
	constructor() {
		super("https://fixture.invalid", "test-only");
	}
	override async streams() {
		return [...this.heads.values()];
	}
	override async create(id: string) {
		const head = {
			id,
			revision: 0,
			checkpointId: null,
			deviceId: null,
			leaseExpiresAt: null,
			updatedAt: new Date().toISOString(),
		};
		this.heads.set(id, head);
		return head;
	}
	override async acquire() {
		return {
			leaseToken: "a".repeat(64),
			fence: 1,
			revision: 0,
			expiresAt: new Date(Date.now() + 120000).toISOString(),
		};
	}
	override async release() {}
	override async publish(
		prepared: PreparedCheckpoint,
		deviceId: string,
		baseRevision: number,
	) {
		const revision = baseRevision + 1;
		this.checkpoints.set(prepared.id, { prepared, revision });
		this.heads.set(prepared.streamId, {
			id: prepared.streamId,
			revision,
			checkpointId: prepared.id,
			deviceId,
			leaseExpiresAt: null,
			updatedAt: new Date().toISOString(),
		});
		return { checkpointId: prepared.id, revision };
	}
	override async download(
		checkpointId: string,
		streamId: string,
		ownerId: string,
		recoveryKey: string,
	) {
		const entry = this.checkpoints.get(checkpointId);
		if (!entry) throw new Error("No checkpoint");
		return {
			revision: entry.revision,
			payload: decryptCheckpoint(
				entry.prepared.manifest,
				entry.prepared.chunks,
				recoveryKey,
				ownerId,
				streamId,
				checkpointId,
			),
		};
	}
}
async function profile(
	parent: string,
	name: string,
	key: string,
	client: FixtureClient,
) {
	const directory = join(parent, name);
	await mkdir(directory);
	const storage = testStorage();
	const vault = new SyncVault(join(directory, "vault"), () => storage);
	vault.write({
		...vault.read(),
		account: {
			id: "fixture-owner",
			email: "fixture@example.com",
			token: "test-only-bearer-token",
			expiresAt: Date.now() + 3600000,
			recoveryKey: key,
		},
	});
	const connection = new SyncConnection(vault, {
		start: async () => {
			throw new Error("Unexpected sign-in");
		},
		wait: async () => {
			throw new Error("Unexpected polling");
		},
		client: () => client,
	});
	const rows: Array<{
		provider: "codex" | "claude";
		sessionId: string;
		title: string;
		cwd: string;
		filePath: string;
		lastModified: number;
		sizeBytes: number;
		projectDirName: string;
		contextTokens: null;
	}> = [];
	const create = async (cwd: string, transcript: string) => {
		const id = randomUUID();
		const filePath = join(directory, `${id}.jsonl`);
		await writeFile(filePath, transcript);
		rows.push({
			provider: "codex",
			sessionId: id,
			title: "A portable task",
			cwd,
			filePath,
			lastModified: Date.now(),
			sizeBytes: transcript.length,
			projectDirName: name,
			contextTokens: null,
		});
		const row = rows.at(-1);
		if (!row) throw new Error("Missing fixture");
		return row;
	};
	let scans = 0;
	const deps = {
		sessions: async () => {
			scans++;
			return rows;
		},
		isBusy: async () => false,
		collect: collectProject,
		restore: restoreProject,
		stat,
		exportSession: async (provider: "codex" | "claude", id: string) => {
			const row = rows.find((item) => item.sessionId === id);
			if (!row) throw new Error("Missing fixture session");
			const file = await stat(row.filePath);
			const session: PortableCheckpoint["session"] = {
				provider,
				title: row.title,
				originalId: id,
				originalCwd: row.cwd,
				format: provider === "codex" ? "codex-rollout-v1" : "claude-jsonl-v1",
				transcript: await readFile(row.filePath, "utf8"),
				attachments: [],
			};
			return {
				session,
				sourceStamp: `${file.mtimeMs}:${file.size}`,
				verify: async () => {},
			};
		},
		importSession: async (
			session: PortableCheckpoint["session"],
			cwd: string,
		) => {
			const created = await create(cwd, session.transcript);
			return {
				sessionId: created.sessionId,
				provider: session.provider,
				cwd,
				title: session.title,
			};
		},
	};
	return {
		transfers: new SyncTransfers(connection, vault, deps),
		rows,
		create,
		directory,
		scans: () => scans,
	};
}
test("two profiles continue independently; a conflict preserves old local work and restores a separate copy", async () => {
	const parent = await mkdtemp(join(tmpdir(), "gatedspace-transfer-test-"));
	dirs.push(parent);
	const client = new FixtureClient(),
		key = newRecoveryKey();
	const a = await profile(parent, "Laptop", key, client),
		b = await profile(parent, "Omen", key, client);
	await a.transfers.tick();
	expect(a.scans()).toBe(0);
	const project = join(a.directory, "Example");
	await mkdir(project);
	execFileSync("git", ["init", "--quiet", "--template=", project], {
		windowsHide: true,
	});
	await writeFile(join(project, "main.ts"), "original source");
	const first = await a.create(
		project,
		'{"user":"Remember lantern","assistant":"Remembered"}\n',
	);
	await a.transfers.send("codex", first.sessionId, project);
	expect(a.transfers.status().bindings[0]?.revision).toBe(1);
	const remote = await b.transfers.available();
	expect(remote).toHaveLength(1);
	const stream = remote[0]?.id;
	if (!stream) throw new Error("Missing remote fixture");
	const restored = await b.transfers.restore(stream, b.directory, "Continued");
	expect(restored.sessionId).not.toBe(first.sessionId);
	const restoredRow = b.rows[0];
	if (!restoredRow) throw new Error("Missing imported fixture");
	expect(await readFile(restoredRow.filePath, "utf8")).toContain(
		"Remember lantern",
	);
	await writeFile(join(restored.cwd, "main.ts"), "OMEN completed change");
	await writeFile(
		restoredRow.filePath,
		'{"user":"Remember lantern","assistant":"OMEN finished another turn"}\n',
	);
	await b.transfers.syncNow(stream);
	expect(b.transfers.status().bindings[0]?.revision).toBe(2);
	await writeFile(join(project, "main.ts"), "Laptop independent work");
	await writeFile(
		first.filePath,
		'{"assistant":"Laptop different completed turn"}\n',
	);
	await a.transfers.tick();
	expect(a.transfers.status().result?.conflicts).toEqual([stream]);
	expect(a.transfers.status().bindings[0]?.revision).toBe(1);
	expect(a.transfers.status().queued).toBe(1);
	const remoteCopy = await a.transfers.restore(stream, a.directory, "OmenCopy");
	expect(await readFile(join(remoteCopy.cwd, "main.ts"), "utf8")).toBe(
		"OMEN completed change",
	);
	expect(await readFile(join(project, "main.ts"), "utf8")).toBe(
		"Laptop independent work",
	);
	expect(a.transfers.status().queued).toBe(0);
	expect(a.transfers.status().bindings[0]?.revision).toBe(2);
	await a.transfers.send("codex", first.sessionId, project);
	expect((await client.streams()).length).toBe(2);
}, 15000);
