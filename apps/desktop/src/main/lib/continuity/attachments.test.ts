import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packAttachments, unpackAttachments } from "./attachments";

const dirs: string[] = [];
afterEach(async () => {
	for (const dir of dirs.splice(0))
		await rm(dir, { recursive: true, force: true });
});
test("local image paths become portable attachments and restore as verified clickable files", async () => {
	const dir = await mkdtemp(join(tmpdir(), "gatedspace-images-test-"));
	dirs.push(dir);
	const path = join(dir, "image.png");
	const png = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9kAAAAASUVORK5CYII=",
		"base64",
	);
	await writeFile(path, png);
	const packed = await packAttachments(
		`${JSON.stringify({ type: "event_msg", payload: { local_images: [path] } })}\n`,
	);
	expect(packed.attachments).toHaveLength(1);
	expect(packed.transcript).not.toContain(JSON.stringify(path));
	const session = {
		provider: "codex" as const,
		title: "Test",
		originalId: "test",
		originalCwd: dir,
		format: "codex-rollout-v1" as const,
		...packed,
	};
	const result = await unpackAttachments(session, join(dir, "restored"));
	const restored = JSON.parse(result).payload.local_images[0];
	expect(await readFile(restored)).toEqual(png);
	expect(restored).not.toBe(path);
	const attachment = packed.attachments[0];
	if (!attachment) throw new Error("missing fixture");
	await expect(
		unpackAttachments(
			{ ...session, attachments: [{ ...attachment, sha256: "0".repeat(64) }] },
			join(dir, "bad"),
		),
	).rejects.toThrow("verification failed");
});
