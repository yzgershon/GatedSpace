import { expect, test } from "bun:test";
import { sessionFromPane, useFocusedSession } from "./focused-session";

test("focus switches usage provider for native and terminal sessions", () => {
	const store = useFocusedSession.getState();
	store.set(sessionFromPane({ id: "claude", kind: "session", data: {} }));
	expect(useFocusedSession.getState().session).toEqual({
		paneId: "claude",
		provider: "claude",
	});
	store.set(
		sessionFromPane({
			id: "codex",
			kind: "session",
			data: { provider: "codex" },
		}),
	);
	expect(useFocusedSession.getState().session).toEqual({
		paneId: "codex",
		provider: "codex",
	});
	expect(
		sessionFromPane({
			id: "terminal",
			kind: "terminal",
			data: { agentId: "codex" },
		})?.provider,
	).toBe("codex");
	expect(sessionFromPane({ id: "file", kind: "file", data: {} })).toBeNull();
	store.set(null);
});
