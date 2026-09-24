import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
	decryptCheckpoint,
	digest,
	encryptCheckpoint,
	newRecoveryKey,
} from "./crypto";
import {
	checkpointSchema,
	excludedProjectPath,
	type PortableCheckpoint,
	safeRelativePath,
} from "./protocol";

const fixture = (): PortableCheckpoint => ({
	version: 1,
	streamId: randomUUID(),
	createdAt: new Date().toISOString(),
	project: {
		name: "Example",
		gitRemote: null,
		gitCommit: null,
		files: [
			{
				path: "src/main.ts",
				content: Buffer.from("Hello").toString("base64"),
				sha256: digest("Hello"),
				executable: false,
			},
		],
	},
	session: {
		provider: "codex",
		title: "A task",
		originalId: randomUUID(),
		originalCwd: "C:\\Project",
		format: "codex-rollout-v1",
		transcript: "private conversation ".repeat(40_000),
		attachments: [],
	},
});
describe("encrypted continuity", () => {
	test("round trips multiple chunks without exposing transcript or file names", () => {
		const payload = fixture(),
			key = newRecoveryKey(),
			id = randomUUID();
		const encrypted = encryptCheckpoint(payload, key, "owner", id);
		expect(encrypted.chunks.length).toBeGreaterThan(1);
		expect(
			Buffer.concat(encrypted.chunks).includes(
				Buffer.from("private conversation"),
			),
		).toBe(false);
		expect(JSON.stringify(encrypted.manifest)).not.toContain("main.ts");
		expect(
			decryptCheckpoint(
				encrypted.manifest,
				encrypted.chunks,
				key,
				"owner",
				payload.streamId,
				id,
			),
		).toEqual(payload);
	});
	test("rejects wrong key, account, stream, checkpoint ID, corruption and reordered chunks", () => {
		const payload = fixture(),
			key = newRecoveryKey(),
			id = randomUUID();
		const encrypted = encryptCheckpoint(payload, key, "owner", id);
		for (const [k, owner, stream, cp] of [
			[newRecoveryKey(), "owner", payload.streamId, id],
			[key, "other", payload.streamId, id],
			[key, "owner", randomUUID(), id],
			[key, "owner", payload.streamId, randomUUID()],
		]) {
			expect(() =>
				decryptCheckpoint(
					encrypted.manifest,
					encrypted.chunks,
					k ?? "",
					owner ?? "",
					stream ?? "",
					cp ?? "",
				),
			).toThrow();
		}
		expect(() =>
			decryptCheckpoint(
				encrypted.manifest,
				[...encrypted.chunks].reverse(),
				key,
				"owner",
				payload.streamId,
				id,
			),
		).toThrow();
		const corrupted = encrypted.chunks.map((chunk) => Buffer.from(chunk));
		corrupted[0]?.fill(0, 31, 32);
		expect(() =>
			decryptCheckpoint(
				encrypted.manifest,
				corrupted,
				key,
				"owner",
				payload.streamId,
				id,
			),
		).toThrow();
	});
	test("rejects incorrect file contents even inside a valid encrypted envelope", () => {
		const payload = fixture(),
			key = newRecoveryKey(),
			id = randomUUID();
		const file = payload.project.files[0];
		if (!file) throw new Error("Missing fixture file");
		file.sha256 = digest("different");
		const encrypted = encryptCheckpoint(payload, key, "owner", id);
		expect(() =>
			decryptCheckpoint(
				encrypted.manifest,
				encrypted.chunks,
				key,
				"owner",
				payload.streamId,
				id,
			),
		).toThrow("File integrity");
	});
	test("rejects cross-platform traversal, special device names, secrets and path collisions", () => {
		for (const path of [
			"../secret",
			"C:/secret",
			"/secret",
			"folder\\file",
			"a/../../b",
			"con",
			"AUX.txt",
			"dir/file:stream",
			"dir/file.",
		])
			expect(safeRelativePath(path)).toBe(false);
		for (const path of [
			".env",
			".env.local",
			".ssh/id_rsa",
			".npmrc",
			"nested/token.json",
			"secret.pem",
			"node_modules/pkg/main.js",
			".git/config",
		])
			expect(excludedProjectPath(path)).toBe(true);
		expect(safeRelativePath("src/components/My File.tsx")).toBe(true);
		const payload = fixture();
		const first = payload.project.files[0];
		if (!first) throw new Error("Missing fixture file");
		payload.project.files.push({
			...first,
			path: "SRC/Main.ts",
		});
		expect(() => checkpointSchema.parse(payload)).toThrow();
	});
});
