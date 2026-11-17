import { realpath } from "node:fs/promises";
import path from "node:path";

export interface FileSessionScope {
	provider: "codex" | "claude";
	key: string;
}

/** Resolve read-only access from the main-process session, never a renderer cwd. */
export async function sessionFileRoot(
	session: FileSessionScope,
	absolutePath: string,
	lookup: (session: FileSessionScope) => string | undefined,
) {
	const cwd = lookup(session);
	if (!cwd || !path.isAbsolute(cwd))
		throw new Error(
			"The session is reconnecting. Retry when its conversation is ready.",
		);
	if (!path.isAbsolute(absolutePath))
		throw new Error("An absolute file path is required.");
	const within = (root: string, target: string) => {
		const relative = path.relative(root, target);
		return (
			relative !== ".." &&
			!relative.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(relative)
		);
	};
	if (!within(cwd, absolutePath))
		throw new Error("This file is outside the session folder.");
	const [root, target] = await Promise.all([
		realpath(cwd),
		realpath(absolutePath),
	]);
	if (!within(root, target))
		throw new Error("This file resolves outside the session folder.");
	return root;
}
