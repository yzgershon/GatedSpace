import type {
	EnsembleMember,
	EnsembleObservation,
	EnsembleSession,
} from "../../../shared/ensemble";
import type { EnsembleTransport } from "./engine";
import { deliveryMarker } from "./protocol";

interface MobileSession {
	provider: "codex" | "claude";
	key: string;
	sessionId: string | null;
	title: string;
	running: boolean;
	cwd?: string;
}
interface MobileView {
	working: boolean;
	error?: string;
	questions: unknown[];
	messages: { id: string; kind: string; text: string; status?: string }[];
}

/** Development bridge for an already-running installed app. Credentials remain in this process. */
export class LocalApiEnsembleTransport implements EnsembleTransport {
	private known = new Map<string, { cwd: string; workspaceId?: string }>();
	private reads = new Map<string, { until: number; value: Promise<unknown> }>();
	constructor(
		private origin: string,
		private token: string,
		private allowedKeys: Set<string>,
	) {
		const url = new URL(origin);
		if (
			url.protocol !== "http:" ||
			url.hostname !== "127.0.0.1" ||
			url.pathname !== "/" ||
			url.search ||
			url.username ||
			url.password
		)
			throw new Error("Use the discovered loopback application API only.");
	}
	remember(key: string, cwd: string, workspaceId?: string) {
		this.known.set(key, { cwd, workspaceId });
		this.allowedKeys.add(key);
	}
	async api<T>(path: string, body?: unknown): Promise<T> {
		if (body !== undefined) this.reads.clear();
		const cached = this.reads.get(path);
		if (body === undefined && cached && cached.until > Date.now())
			return cached.value as Promise<T>;
		const request = this.request<T>(path, body);
		if (body === undefined) {
			this.reads.set(path, { until: Date.now() + 750, value: request });
			void request.catch(() => this.reads.delete(path));
		}
		return request;
	}
	private async request<T>(path: string, body?: unknown): Promise<T> {
		const response = await fetch(`${this.origin}${path}`, {
			method: body === undefined ? "GET" : "POST",
			headers: {
				"x-bridge-token": this.token,
				...(body === undefined ? {} : { "content-type": "application/json" }),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(12_000),
			redirect: "error",
		});
		if (!response.ok)
			throw new Error(
				`Native session API returned ${response.status}. Inspect the native conversation before retrying.`,
			);
		return (await response.json()) as T;
	}
	async list(): Promise<EnsembleSession[]> {
		const data = await this.api<{
			sessions: MobileSession[];
			history: { provider: string; sessionId: string; cwd?: string }[];
		}>("/api/mobile/sessions");
		return Promise.all(
			data.sessions
				.filter((s) => this.allowedKeys.has(s.key))
				.map(async (s): Promise<EnsembleSession> => {
					const known = this.known.get(s.key);
					const history = data.history.find(
						(h) => h.provider === s.provider && h.sessionId === s.sessionId,
					);
					const member = {
						id: "",
						provider: s.provider,
						key: s.key,
						conversationId: s.sessionId,
						title: s.title,
						cwd: known?.cwd ?? s.cwd ?? history?.cwd ?? "",
						workspaceId: known?.workspaceId,
						role: "Contributor",
					};
					const view = await this.inspect(member);
					return { ...member, status: view.status };
				}),
		);
	}
	async inspect(
		member: EnsembleMember,
		messageId?: string,
	): Promise<EnsembleObservation> {
		if (!this.allowedKeys.has(member.key))
			throw new Error("This session is outside the live demonstration scope.");
		const sessions = await this.api<{ sessions: MobileSession[] }>(
			"/api/mobile/sessions",
		);
		const live = sessions.sessions.find(
			(s) => s.provider === member.provider && s.key === member.key,
		);
		if (!live) return { status: "offline", conversationId: null };
		const view = await this.api<MobileView>(
			`/api/mobile/${member.provider}/${encodeURIComponent(member.key)}`,
		);
		let working = view.working;
		let successful = !view.error;
		if (member.provider === "claude" && !view.questions?.length) {
			// Older installed versions inferred activity from replayed transcripts.
			// Prefer explicit top-level terminal protocol events, not a text heuristic.
			const raw = await this.api<{ events: Record<string, unknown>[] }>(
				`/api/sessions/${encodeURIComponent(member.key)}/events?limit=100`,
			);
			const conversation = raw.events.filter(
				(e) =>
					!e.parent_tool_use_id &&
					[
						"local_user_message",
						"assistant",
						"result",
						"stream_event",
					].includes(String(e.type)),
			);
			const last = conversation.at(-1);
			if (last?.type === "result") {
				working = false;
				successful = !last.is_error;
			} else if (
				last?.type === "assistant" &&
				(last.message as { stop_reason?: string })?.stop_reason === "end_turn"
			)
				working = false;
		}
		const base: EnsembleObservation = {
			status: view.questions?.length
				? "attention"
				: view.error
					? "error"
					: working
						? "working"
						: "idle",
			conversationId: live.sessionId,
			error: view.error,
		};
		if (!messageId) return base;
		const index = view.messages.findLastIndex(
			(m) => m.kind === "user" && m.text.startsWith(deliveryMarker(messageId)),
		);
		if (index < 0) return { ...base, intervened: true };
		const following = view.messages.slice(index + 1);
		if (following.some((m) => m.kind === "user"))
			return { ...base, intervened: true };
		if (base.status === "idle") {
			const replies = following.filter(
				(m) => m.kind === "assistant" && m.text.trim(),
			);
			if (replies.length)
				return {
					...base,
					response: {
						text: replies.map((m) => m.text).join("\n\n"),
						successful,
					},
				};
		}
		return base;
	}
	async send(member: EnsembleMember, text: string, messageId: string) {
		this.reads.clear(); // Never make a delivery decision from a display cache.
		const before = await this.inspect(member);
		if (
			before.status !== "idle" ||
			(member.conversationId && before.conversationId !== member.conversationId)
		)
			throw new Error(
				"The conversation is busy, waiting for input, or changed identity.",
			);
		await this.api(
			`/api/mobile/${member.provider}/${encodeURIComponent(member.key)}/send`,
			{ requestId: messageId, text },
		);
	}
	async interrupt(member: EnsembleMember) {
		await this.api(
			`/api/mobile/${member.provider}/${encodeURIComponent(member.key)}/stop`,
			{},
		);
	}
}
