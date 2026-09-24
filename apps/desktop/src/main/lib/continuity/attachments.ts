import { lstat, open, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { PortableCheckpoint } from "@superset/shared/continuity";
import { digest } from "@superset/shared/continuity/crypto";
import {
	ensureSecureDir,
	secureExistingFile,
} from "../secure-file/secure-file";

function image(data: Buffer) {
	return (
		data
			.subarray(0, 8)
			.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
		(data[0] === 255 && data[1] === 216 && data[2] === 255) ||
		/^GIF8[79]a/.test(data.subarray(0, 6).toString()) ||
		(data.subarray(0, 4).toString() === "RIFF" &&
			data.subarray(8, 12).toString() === "WEBP")
	);
}
function visit(
	value: unknown,
	fn: (row: Record<string, unknown>) => void,
	depth = 0,
) {
	if (depth > 100)
		throw new Error(
			"Transcript attachment nesting exceeds the transfer limit.",
		);
	if (!value || typeof value !== "object") return;
	if (Array.isArray(value)) {
		for (const item of value) visit(item, fn, depth + 1);
		return;
	}
	const row = value as Record<string, unknown>;
	fn(row);
	for (const child of Object.values(row)) visit(child, fn, depth + 1);
}
export async function packAttachments(transcript: string) {
	const rows: unknown[] = transcript
		.trimEnd()
		.split("\n")
		.map((line) => JSON.parse(line));
	const paths = new Set<string>();
	for (const row of rows)
		visit(row, (item) => {
			if (Array.isArray(item.local_images))
				for (const path of item.local_images)
					if (typeof path === "string") paths.add(path);
			if (
				(item.type === "localImage" || item.type === "local_image") &&
				typeof item.path === "string"
			)
				paths.add(item.path);
		});
	const replacements = new Map<string, string>();
	const attachments: PortableCheckpoint["session"]["attachments"] = [];
	let total = 0;
	for (const path of paths) {
		const metadata = await lstat(path).catch(() => null);
		if (!metadata) continue; // A deleted attachment remains an honest missing preview.
		if (
			!metadata.isFile() ||
			metadata.isSymbolicLink() ||
			metadata.size > 16 * 1024 * 1024 ||
			!/^\.(png|jpe?g|webp|gif)$/i.test(extname(path))
		)
			throw new Error("An image attachment cannot be transferred safely.");
		const handle = await open(path, "r");
		const data = Buffer.alloc(metadata.size);
		try {
			const before = await handle.stat();
			if (
				before.size !== metadata.size ||
				before.ino !== metadata.ino ||
				before.mtimeMs !== metadata.mtimeMs
			)
				throw new Error(
					"An image changed during export. Retry the checkpoint.",
				);
			let offset = 0;
			while (offset < data.length) {
				const { bytesRead } = await handle.read(
					data,
					offset,
					data.length - offset,
					offset,
				);
				if (!bytesRead) break;
				offset += bytesRead;
			}
			const after = await handle.stat();
			if (
				offset !== data.length ||
				after.size !== before.size ||
				after.mtimeMs !== before.mtimeMs
			)
				throw new Error(
					"An image changed during export. Retry the checkpoint.",
				);
		} finally {
			await handle.close();
		}
		total += data.length;
		if (!image(data) || total > 64 * 1024 * 1024)
			throw new Error(
				"Image attachments exceed the transfer limit or have an unsupported format.",
			);
		const name = `${digest(data)}${extname(path).toLowerCase()}`;
		if (!attachments.some((entry) => entry.path === name))
			attachments.push({
				path: name,
				content: data.toString("base64"),
				sha256: digest(data),
				executable: false,
			});
		replacements.set(path, `gatedspace-attachment://${name}`);
	}
	return { transcript: replaceStrings(rows, replacements), attachments };
}
function replaceStrings(rows: unknown[], replacements: Map<string, string>) {
	return `${rows.map((row) => JSON.stringify(row, (_key, value: unknown) => (typeof value === "string" ? (replacements.get(value) ?? value) : value))).join("\n")}\n`;
}
export async function unpackAttachments(
	session: PortableCheckpoint["session"],
	directory: string,
) {
	const replacements = new Map<string, string>();
	let total = 0;
	ensureSecureDir(directory);
	for (const attachment of session.attachments) {
		if (!/^[a-f0-9]{64}\.(png|jpe?g|webp|gif)$/.test(attachment.path))
			throw new Error("Invalid attachment filename.");
		const data = Buffer.from(attachment.content, "base64");
		total += data.length;
		if (
			!image(data) ||
			digest(data) !== attachment.sha256 ||
			!attachment.path.startsWith(attachment.sha256) ||
			data.length > 16 * 1024 * 1024 ||
			total > 64 * 1024 * 1024
		)
			throw new Error("Image attachment verification failed.");
		const path = join(directory, attachment.path);
		await writeFile(path, data, { flag: "wx", mode: 0o600 });
		secureExistingFile(path);
		replacements.set(`gatedspace-attachment://${attachment.path}`, path);
	}
	return replaceStrings(
		session.transcript
			.trimEnd()
			.split("\n")
			.map((line) => JSON.parse(line)),
		replacements,
	);
}
