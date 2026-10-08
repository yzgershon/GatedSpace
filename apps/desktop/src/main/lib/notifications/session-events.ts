import { EventEmitter } from "node:events";
import type { SessionNotificationState } from "../../../shared/session-notifications";

/** Native sessions own their lifecycle. Shell hooks (including child agents)
 * must never announce completion for these sessions. No transcript replay enters here. */
export class SessionEvents extends EventEmitter {
	hasQueuedContinuation: (key: string) => boolean = () => false;
	private deferredCompletions = new Set<string>();
	private sessions = new Map<string, SessionNotificationState>();
	private active = new Map<string, string>();
	private contexts = new Map<
		string,
		{ title?: string; workspaceId?: string; visible?: boolean }
	>();
	private ownedIds = new Set<string>();

	open(key: string, provider: "claude" | "codex", workspaceId?: string) {
		this.sessions.set(key, { key, provider, workspaceId, status: "idle" });
		this.active.delete(key);
		this.changed(key);
	}
	context(
		key: string,
		context: { title?: string; workspaceId?: string; visible?: boolean },
	) {
		this.contexts.set(key, context);
	}
	bind(key: string, sessionId: string, title?: string) {
		const state = this.sessions.get(key);
		if (!state) return;
		const previousId = state.sessionId;
		if (sessionId) state.sessionId = sessionId;
		if (title) state.title = title;
		if (sessionId) this.ownedIds.add(sessionId);
		if (sessionId && previousId !== sessionId)
			this.emit("bound", { key, sessionId, previousId });
		// Keep closed-session hook ownership bounded, without forgetting live sessions.
		if (this.ownedIds.size > 2000) {
			this.ownedIds = new Set(
				[...this.sessions.values()].flatMap((s) =>
					s.sessionId ? [s.sessionId] : [],
				),
			);
		}
	}
	work(key: string, turnId: string) {
		this.deferredCompletions.delete(key);
		this.active.set(key, turnId);
		const state = this.sessions.get(key);
		if (state) state.turnId = undefined;
		this.setStatus(key, "working");
	}
	bindTurn(key: string, turnId: string) {
		if (this.active.has(key)) this.active.set(key, turnId);
	}
	status(key: string, status: "working" | "attention" | "idle" | "error") {
		if (status === "idle" || status === "error") this.active.delete(key);
		this.setStatus(key, status);
	}
	finish(key: string, turnId: string, successful: boolean, pending = false) {
		if (this.active.get(key) !== turnId) return;
		this.active.delete(key);
		const state = this.sessions.get(key);
		if (!state) return;
		state.turnId = turnId;
		this.setStatus(
			key,
			pending ? "attention" : successful ? "completed" : "idle",
		);
		if (successful && !pending) {
			if (this.hasQueuedContinuation(key)) this.deferredCompletions.add(key);
			else this.emit("notice", this.get(key));
		}
	}
	flushQueuedCompletion(key: string) {
		if (
			this.deferredCompletions.delete(key) &&
			this.get(key)?.status === "completed"
		)
			this.emit("notice", this.get(key));
	}
	close(key: string) {
		this.status(key, "idle");
		this.sessions.delete(key);
		this.contexts.delete(key);
	}
	owns(paneId?: string, sessionId?: string) {
		return Boolean(
			(paneId && this.sessions.has(paneId)) ||
				(sessionId && this.ownedIds.has(sessionId)),
		);
	}
	getContext(key: string) {
		return this.contexts.get(key);
	}
	get(key: string): SessionNotificationState | undefined {
		const state = this.sessions.get(key);
		const context = this.contexts.get(key);
		return state
			? { ...state, ...context, title: context?.title?.trim() || state.title }
			: undefined;
	}
	list() {
		return [...this.sessions.keys()].flatMap((key) => {
			const state = this.get(key);
			return state ? [state] : [];
		});
	}
	private setStatus(key: string, status: SessionNotificationState["status"]) {
		const state = this.sessions.get(key);
		if (!state || state.status === status) return;
		state.status = status;
		this.changed(key);
		if (status === "attention") this.emit("notice", this.get(key));
	}
	private changed(key: string) {
		this.emit("change", this.get(key));
	}
}

export const sessionEvents = new SessionEvents();
