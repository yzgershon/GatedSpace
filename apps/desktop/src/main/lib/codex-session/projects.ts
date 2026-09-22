import { basename, win32 } from "node:path";
import { list, record, text } from "../../../shared/codex-session/types";

function pathKey(path: string) {
	return (
		/^(?:[a-z]:[\\/]|\\\\|\/\/)/i.test(path)
			? win32.normalize(path).replaceAll("\\", "/").toLowerCase()
			: path
	).replace(/\/+$/, "");
}

/** Prefer the most specific registered folder, without matching sibling prefixes. */
export function matchingProject(
	projects: unknown[],
	cwd: string,
): string | undefined {
	const target = pathKey(cwd);
	let match: { id: string; length: number } | undefined;
	for (const value of projects) {
		const project = record(value);
		for (const root of list(project.roots)) {
			const path = pathKey(text(record(root).path));
			if (
				path &&
				(target === path || target.startsWith(`${path}/`)) &&
				(!match || path.length > match.length)
			) {
				match = { id: text(project.id), length: path.length };
			}
		}
	}
	return match?.id || undefined;
}

export async function resolveCodexProject(
	request: (
		method: string,
		params: Record<string, unknown>,
	) => Promise<unknown>,
	cwd: string,
): Promise<string | undefined> {
	const projects: unknown[] = [];
	let cursor: string | null = null;
	do {
		const page = record(await request("project/list", { limit: 100, cursor }));
		projects.push(...list(page.data));
		cursor = text(page.nextCursor) || null;
	} while (cursor);
	const existing = matchingProject(projects, cwd);
	if (existing) return existing;
	const created = record(
		await request("project/create", {
			name:
				(win32.isAbsolute(cwd) ? win32.basename(cwd) : basename(cwd)) || cwd,
			roots: [{ path: cwd }],
			idempotencyKey: `gatedspace:${pathKey(cwd)}`,
		}),
	);
	return text(record(created.project).id) || undefined;
}
