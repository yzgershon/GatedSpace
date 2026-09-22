const ids = [
	"00000000-0000-4000-8000-000000000001",
	"00000000-0000-4000-8000-000000000002",
	"00000000-0000-4000-8000-000000000003",
];
const rows = ["App edits", "Research", "Assistant"].map((title, index) => ({
	sessionId: ids[index],
	title,
	cwd: "C:/Dev",
	lastModified: Date.now() - index * 86400000,
	pinned: true,
}));
export const electronTrpcClient = {
	claudeSessions: {
		pinnedCodex: { query: async () => rows.filter((r) => r.pinned) },
		list: {
			query: async ({
				provider,
				search = "",
			}: {
				provider: string;
				search?: string;
			}) =>
				provider === "codex"
					? rows
							.filter((r) =>
								r.title.toLowerCase().includes(search.toLowerCase()),
							)
							.map((row) => ({ ...row }))
					: [],
		},
		searchContent: { query: async () => [] },
		pinCodex: {
			mutate: async ({
				sessionId,
				pinned,
			}: {
				sessionId: string;
				pinned: boolean;
			}) => {
				const row = rows.find((r) => r.sessionId === sessionId);
				if (row) row.pinned = pinned;
			},
		},
		rename: { mutate: async () => {} },
		remove: { mutate: async () => ({ ok: true }) },
	},
	claudeSession: { liveSessionIds: { query: async () => [] } },
	codexSession: { liveSessionIds: { query: async () => [] } },
};
