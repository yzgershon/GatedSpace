import { detectImageMime } from "shared/image-attachments";

const INLINE_TEXT_BYTES = 200_000;
const TEXT_EXTENSION =
	/\.(txt|md|json|csv|ts|tsx|js|jsx|css|html|py|rs|go|sh|ps1|yaml|yml|toml|xml|sql|log)$/i;

/** Local documents stay on disk. Both native agents can read a user-selected
 * path with their existing tools and permissions; no binary document blocks or
 * large text copies need to be injected into the conversation. */
export async function resolveChatFile(
	file: File,
	getPath = (value: File) => window.webUtils?.getPathForFile(value) ?? "",
): Promise<
	{ kind: "image"; mime: string } | { kind: "reference"; text: string }
> {
	let path = "";
	try {
		path = getPath(file);
	} catch {
		// Clipboard blobs have no on-disk path. Images and small text still work.
	}
	let mime: string | null;
	try {
		mime = await detectImageMime(file);
	} catch {
		// Explorer directories have a real path but cannot be read as a Blob.
		if (path && !file.type.startsWith("image/"))
			return { kind: "reference", text: path };
		throw new Error(
			`Could not read ${file.name}. Save it to your computer and try again.`,
		);
	}
	if (mime) return { kind: "image", mime };
	if (path) return { kind: "reference", text: path };
	if (
		file.size <= INLINE_TEXT_BYTES &&
		(file.type.startsWith("text/") || TEXT_EXTENSION.test(file.name))
	) {
		return {
			kind: "reference",
			text: `File: ${file.name}\n\`\`\`\n${await file.text()}\n\`\`\``,
		};
	}
	throw new Error(
		`${file.name}: this file has no local path. Save it to your computer, then drag it here or use + to attach it.`,
	);
}

export function appendFileReference(current: string, reference: string) {
	return `${current}${current.trim() ? "\n\n" : ""}${reference}`;
}
