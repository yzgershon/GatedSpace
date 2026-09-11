import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, normalize, parse, resolve, sep } from "node:path";

/**
 * Extra folders that Ctrl+T searches in addition to the open workspace.
 *
 * Quick-open is rooted at one workspace, so a file in a sibling project is
 * unreachable no matter what you type. This adds a sidecar list of absolute
 * paths that are searched alongside it — the same shape as the other
 * `~/.superset/*.json` sidecars (claude-profile.json, session-titles.json).
 *
 *     // ~/.superset/search-roots.json
 *     { "roots": ["C:\\Dev"] }
 *
 * Deliberately a config file and not "just search the parent directory": a
 * project checked out at a drive root would silently try to index the whole
 * drive. An explicit list cannot surprise anyone.
 */
export const SEARCH_ROOTS_FILE = "search-roots.json";

const CACHE_TTL_MS = 10_000;

let cache: { roots: string[]; at: number } | null = null;

function configPath(): string {
	return join(homedir(), ".superset", SEARCH_ROOTS_FILE);
}

/** Hand-rolled rather than zod: this runs before the router's schemas and a
 * malformed config must degrade to "no extra roots", never throw. */
function hasRootsArray(value: unknown): value is { roots: unknown[] } {
	return (
		typeof value === "object" &&
		value !== null &&
		"roots" in value &&
		Array.isArray((value as { roots: unknown }).roots)
	);
}

/** Absolute, existing directories only. A bad entry is skipped, not fatal. */
export async function readExtraSearchRoots(
	now = Date.now(),
): Promise<string[]> {
	if (cache && now - cache.at < CACHE_TTL_MS) return cache.roots;

	let parsed: unknown;
	try {
		parsed = JSON.parse(await readFile(configPath(), "utf8"));
	} catch {
		// Absent or unreadable is the normal case — no extra roots configured.
		cache = { roots: [], at: now };
		return [];
	}

	const raw = hasRootsArray(parsed) ? parsed.roots : [];

	const roots: string[] = [];
	for (const entry of raw) {
		if (typeof entry !== "string" || !entry.trim()) continue;
		const candidate = normalize(entry.trim());
		if (!isAbsolute(candidate)) continue;
		try {
			if ((await stat(candidate)).isDirectory()) roots.push(candidate);
		} catch {
			// Configured but missing — skip rather than fail the whole search.
		}
	}

	cache = { roots, at: now };
	return roots;
}

/** Test seam: the TTL cache would otherwise leak between cases. */
export function clearSearchRootsCache(): void {
	cache = null;
}

function withinRoot(candidate: string, root: string): boolean {
	const rel = resolve(candidate).slice(resolve(root).length);
	return (
		resolve(candidate).toLowerCase().startsWith(resolve(root).toLowerCase()) &&
		(rel === "" || rel.startsWith(sep) || rel.startsWith("/"))
	);
}

/**
 * Resolve a query the user typed as a PATH rather than a name.
 *
 * `Dev\superset\HANDOFF.md` should find `C:\Dev\superset\HANDOFF.md`, which
 * means the parent of each configured root has to be a base too — joining that
 * query onto `C:\Dev` itself would give `C:\Dev\Dev\superset\...`.
 *
 * The result must still land inside the workspace or a configured root. Without
 * that check the palette becomes an arbitrary-file browser for anything the
 * process can read.
 */
export async function resolveTypedPath(
	query: string,
	workspaceRoot: string | undefined,
	extraRoots: string[],
): Promise<string | null> {
	const trimmed = query.trim();
	if (!trimmed || !/[\\/]/.test(trimmed)) return null;

	const allowed = [...extraRoots, ...(workspaceRoot ? [workspaceRoot] : [])];
	if (allowed.length === 0) return null;

	const bases = new Set<string>();
	for (const root of allowed) {
		bases.add(root);
		const { dir, root: driveRoot } = parse(root);
		// Stop at the drive root so `C:\` is a base but nothing above it is.
		if (dir && dir !== root) bases.add(dir);
		else if (driveRoot) bases.add(driveRoot);
	}

	const candidates: string[] = [];
	if (isAbsolute(trimmed)) candidates.push(normalize(trimmed));
	const relative = trimmed.replace(/^[\\/]+/, "");
	for (const base of bases) candidates.push(resolve(base, relative));

	for (const candidate of candidates) {
		if (!allowed.some((root) => withinRoot(candidate, root))) continue;
		try {
			if ((await stat(candidate)).isFile()) return candidate;
		} catch {
			// Next candidate.
		}
	}
	return null;
}
