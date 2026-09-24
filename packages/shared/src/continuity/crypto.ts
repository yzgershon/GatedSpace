import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
} from "node:crypto";
import {
	CHUNK_BYTES,
	type CheckpointManifest,
	checkpointSchema,
	MAX_CHECKPOINT_BYTES,
	manifestSchema,
	type PortableCheckpoint,
} from "./protocol";

export const digest = (data: Uint8Array | string) =>
	createHash("sha256").update(data).digest("hex");
export function newRecoveryKey(): string {
	return randomBytes(32).toString("base64url");
}
export function parseRecoveryKey(text: string): Buffer {
	if (!/^[A-Za-z0-9_-]{43}$/.test(text))
		throw new Error("Enter the complete GatedSpace recovery key.");
	const key = Buffer.from(text, "base64url");
	if (key.length !== 32 || key.toString("base64url") !== text)
		throw new Error("Invalid recovery key.");
	return key;
}

function aad(
	ownerId: string,
	streamId: string,
	checkpointId: string,
	index: number,
): Buffer {
	return Buffer.from(
		JSON.stringify([
			"gatedspace-continuity",
			1,
			ownerId,
			streamId,
			checkpointId,
			index,
		]),
	);
}
export function encryptCheckpoint(
	payload: PortableCheckpoint,
	recoveryKey: string,
	ownerId: string,
	checkpointId: string,
) {
	const value = checkpointSchema.parse(payload);
	const plain = Buffer.from(JSON.stringify(value));
	if (plain.length > MAX_CHECKPOINT_BYTES)
		throw new Error("Checkpoint exceeds the size limit.");
	const key = parseRecoveryKey(recoveryKey);
	const chunks: Buffer[] = [];
	try {
		for (let start = 0; start < plain.length; start += CHUNK_BYTES) {
			const nonce = randomBytes(12);
			const cipher = createCipheriv("aes-256-gcm", key, nonce);
			cipher.setAAD(aad(ownerId, value.streamId, checkpointId, chunks.length));
			const encrypted = Buffer.concat([
				cipher.update(plain.subarray(start, start + CHUNK_BYTES)),
				cipher.final(),
			]);
			chunks.push(
				Buffer.concat([
					Buffer.from([1]),
					nonce,
					cipher.getAuthTag(),
					encrypted,
				]),
			);
		}
		const manifest: CheckpointManifest = {
			version: 1,
			chunks: chunks.map((chunk) => ({
				id: digest(chunk),
				bytes: chunk.length,
			})),
		};
		return { manifest: manifestSchema.parse(manifest), chunks };
	} finally {
		key.fill(0);
		plain.fill(0);
	}
}

export function decryptCheckpoint(
	manifestInput: CheckpointManifest,
	chunks: Uint8Array[],
	recoveryKey: string,
	ownerId: string,
	streamId: string,
	checkpointId: string,
): PortableCheckpoint {
	const manifest = manifestSchema.parse(manifestInput);
	if (chunks.length !== manifest.chunks.length)
		throw new Error("Checkpoint is incomplete.");
	const key = parseRecoveryKey(recoveryKey);
	const parts: Buffer[] = [];
	try {
		for (const [index, bytes] of chunks.entries()) {
			const expected = manifest.chunks[index];
			if (
				!expected ||
				bytes.length !== expected.bytes ||
				digest(bytes) !== expected.id ||
				bytes[0] !== 1
			)
				throw new Error("Checkpoint integrity check failed.");
			const chunk = Buffer.from(bytes);
			const cipher = createDecipheriv(
				"aes-256-gcm",
				key,
				chunk.subarray(1, 13),
			);
			cipher.setAAD(aad(ownerId, streamId, checkpointId, index));
			cipher.setAuthTag(chunk.subarray(13, 29));
			parts.push(
				Buffer.concat([cipher.update(chunk.subarray(29)), cipher.final()]),
			);
		}
		const plain = Buffer.concat(parts);
		try {
			if (plain.length > MAX_CHECKPOINT_BYTES)
				throw new Error("Checkpoint exceeds the size limit.");
			const value = checkpointSchema.parse(JSON.parse(plain.toString("utf8")));
			if (value.streamId !== streamId)
				throw new Error("Checkpoint belongs to a different session.");
			for (const file of [
				...value.project.files,
				...value.session.attachments,
			]) {
				const bytes = Buffer.from(file.content, "base64");
				if (
					bytes.toString("base64") !== file.content ||
					digest(bytes) !== file.sha256
				)
					throw new Error("File integrity check failed.");
			}
			return value;
		} finally {
			plain.fill(0);
		}
	} finally {
		key.fill(0);
		for (const part of parts) part.fill(0);
	}
}
