import { defaultCodexPermission } from "../../../shared/codex-session/permissions";
import type {
	EnsembleMember,
	EnsembleObservation,
	EnsembleSession,
} from "../../../shared/ensemble";
import { claudeSessionManager as claude } from "../claude-session/session-manager";
import { codexSessionManager as codex } from "../codex-session/session-manager";
import { sessionEvents } from "../notifications/session-events";
import { sessionNames } from "../session-names";
import type { EnsembleTransport } from "./engine";
import { deliveryMarker } from "./protocol";

export class NativeEnsembleTransport implements EnsembleTransport {
	async list(): Promise<EnsembleSession[]> {
		return [
			...codex.listSessions().map(
				(s): EnsembleSession => ({
					provider: "codex",
					key: s.key,
					conversationId: s.threadId,
					title: s.title || "Codex",
					cwd: s.cwd,
					workspaceId: sessionEvents.get(s.key)?.workspaceId,
					role: "Contributor",
					status: s.approvals.length
						? "attention"
						: s.status === "loading"
							? "working"
							: s.status,
				}),
			),
			...claude.listSessions().flatMap((s): EnsembleSession[] => {
				const ctx = claude.getContext(s.key);
				if (!ctx) return [];
				const status = sessionEvents.get(s.key)?.status;
				return [
					{
						...ctx,
						provider: "claude",
						key: s.key,
						conversationId: s.sessionId,
						title:
							sessionNames.get({
								provider: "claude",
								key: s.key,
								id: s.sessionId ?? undefined,
							}) ?? "Claude",
						role: "Contributor",
						status: !s.running
							? "offline"
							: status === "attention" || status === "error"
								? status
								: claude.isBusy(s.key)
									? "working"
									: "idle",
					},
				];
			}),
		];
	}
	async inspect(
		member: EnsembleMember,
		messageId?: string,
	): Promise<EnsembleObservation> {
		const live = (await this.list()).find(
			(s) => s.provider === member.provider && s.key === member.key,
		);
		if (!live) return { status: "offline", conversationId: null };
		const base: EnsembleObservation = {
			status: live.status,
			conversationId: live.conversationId,
		};
		if (!messageId) return base;
		if (member.provider === "codex") {
			const s = codex.get(member.key);
			if (!s) return base;
			const index = s.items.findLastIndex(
				(i) =>
					i.kind === "user" && i.text.startsWith(deliveryMarker(messageId)),
			);
			if (index < 0) return { ...base, intervened: true };
			const following = s.items.slice(index + 1);
			if (following.some((i) => i.kind === "user"))
				return { ...base, intervened: true };
			const turn = s.items[index].turnId;
			const finished = s.turns?.find((t) => t.id === turn);
			if (
				base.status === "idle" &&
				finished &&
				["interrupted", "failed"].includes(finished.status)
			)
				return {
					...base,
					response: {
						text: s.error || `Native turn ${finished.status}.`,
						successful: false,
					},
				};
			if (base.status === "idle" && finished?.status === "completed")
				return {
					...base,
					response: {
						text: following
							.filter(
								(i) =>
									i.kind === "assistant" &&
									i.turnId === turn &&
									i.phase !== "commentary",
							)
							.map((i) => i.text)
							.join("\n\n"),
						successful: !s.error,
					},
				};
			return base;
		}
		const events = claude.getBufferedEvents(member.key);
		const index = events.findLastIndex(
			(e) =>
				e.type === "local_user_message" &&
				e.text.startsWith(deliveryMarker(messageId)),
		);
		if (index < 0) return { ...base, intervened: true };
		const following = events.slice(index + 1);
		if (following.some((e) => e.type === "local_user_message"))
			return { ...base, intervened: true };
		const result = following
			.filter((e) => e.type === "result")
			.findLast((e) => !e.parent_tool_use_id);
		if (result && base.status !== "working" && base.status !== "attention") {
			const assistant = following.findLast(
				(e) => e.type === "assistant" && !e.parent_tool_use_id,
			);
			const text =
				result.result ||
				(assistant?.type === "assistant"
					? assistant.message.content
							.filter((b) => b.type === "text")
							.map((b) => b.text)
							.join("\n\n")
					: "");
			return { ...base, response: { text, successful: !result.is_error } };
		}
		return base;
	}
	async send(member: EnsembleMember, text: string, _messageId: string) {
		const before = await this.inspect(member);
		if (
			before.status !== "idle" ||
			(member.conversationId && before.conversationId !== member.conversationId)
		)
			throw new Error("The session became busy or changed before delivery.");
		if (member.provider === "codex") {
			const state = codex.get(member.key);
			if (!state) throw new Error("Codex disconnected.");
			await codex.send({
				key: member.key,
				text,
				model: state.model,
				effort: state.effort,
				permission: state.permission ?? defaultCodexPermission(),
			});
		} else claude.send(member.key, text);
	}
	async interrupt(member: EnsembleMember) {
		if (member.provider === "codex") await codex.interrupt(member.key);
		else claude.interrupt(member.key);
	}
}
