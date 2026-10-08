export function projectCollectionKey(cwd: string | null) {
	const path = (cwd ?? "").replace(/\\/g, "/").replace(/\/$/, "");
	return /^[a-z]:\//i.test(path) ? path.toLowerCase() : path;
}
export function groupSessionCollections<
	T extends { pinned?: boolean; cwd: string | null; lastModified: number },
>(sessions: T[]) {
	const groups = new Map<string, T[]>();
	const ordered = [...sessions].sort(
		(a, b) =>
			Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
			b.lastModified - a.lastModified,
	);
	for (const session of ordered) {
		const key = session.pinned ? "@pinned" : projectCollectionKey(session.cwd);
		const group = groups.get(key) ?? [];
		group.push(session);
		groups.set(key, group);
	}
	return [...groups.entries()];
}
