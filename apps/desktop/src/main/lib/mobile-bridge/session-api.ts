import { createHash, randomUUID } from "node:crypto";
import express from "express";
import { z } from "zod";
import { buildTimeline } from "../../../shared/claude-session/timeline";
import { claudeSessionManager as claude } from "../claude-session/session-manager";
import { loadSessionTranscript } from "../claude-session/transcript";
import { listClaudeSessions } from "../claude-sessions/claude-sessions";
import { codexSessionManager as codex } from "../codex-session/session-manager";
import {
	type MobileMessage,
	type MobileProvider,
	messagePage,
	promptSchema,
	providerSchema,
	RequestLedger,
} from "./session-contract";
import { mergeTranscriptWithBuffer } from "./transcript-merge";
import { listBridgeWorkspaceTargets } from "./workspace-targets";

const ledger = new RequestLedger();
// One unavailable agent must not block the other provider's live sessions.
let codexHistory: Awaited<ReturnType<typeof codex.listThreads>> = [];
let historyAt = 0;
let historyPending: Promise<void> | undefined;
async function recentCodexHistory() {
	if (Date.now() - historyAt < 15_000)
		return { items: codexHistory, pending: false };
	if (!historyPending) {
		historyPending = codex
			.listThreads(100)
			.then((items) => {
				codexHistory = items;
				historyAt = Date.now();
			})
			.finally(() => {
				historyPending = undefined;
			});
	}
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		const done = await Promise.race([
			historyPending.then(() => true),
			new Promise<false>((resolve) => {
				timeout = setTimeout(() => resolve(false), 2_000);
			}),
		]);
		return { items: codexHistory, pending: !done };
	} finally {
		clearTimeout(timeout);
	}
}
// Disk replay is cached for a short window; live buffered events are always merged.
const transcripts = new Map<
	string,
	{ at: number; events: ReturnType<typeof loadSessionTranscript> }
>();
function claudeTimeline(key: string) {
	const session = claude.listSessions().find((s) => s.key === key);
	if (!session)
		throw new Error("This session is no longer open. Reopen it from History.");
	let stored = session.sessionId
		? transcripts.get(session.sessionId)
		: undefined;
	if (session.sessionId && (!stored || Date.now() - stored.at > 5_000)) {
		stored = {
			at: Date.now(),
			events: loadSessionTranscript(session.sessionId),
		};
		if (transcripts.size >= 12)
			transcripts.delete(transcripts.keys().next().value ?? "");
		transcripts.set(session.sessionId, stored);
	}
	return buildTimeline(
		mergeTranscriptWithBuffer(
			stored?.events ?? [],
			claude.getBufferedEvents(key),
		),
	);
}

function codexState(key: string) {
	const state = codex.get(key);
	if (!state)
		throw new Error("This session is no longer open. Reopen it from History.");
	return state;
}

export function mobileSessionRouter() {
	const router = express.Router();
	const handle =
		(fn: (req: express.Request, res: express.Response) => Promise<unknown>) =>
		(req: express.Request, res: express.Response) => {
			void fn(req, res).catch((error: unknown) => {
				res.status(error instanceof z.ZodError ? 400 : 409).json({
					error:
						error instanceof z.ZodError
							? "Invalid session request."
							: error instanceof Error
								? error.message
								: "Session request failed.",
				});
			});
		};
	const providerKey = (req: express.Request) => ({
		provider: providerSchema.parse(req.params.provider),
		key: String(req.params.key),
	});
	const once = <T>(req: express.Request, action: () => Promise<T>) => {
		const id = z.string().uuid().parse(req.body?.requestId);
		const signature = createHash("sha256")
			.update(req.path)
			.update(JSON.stringify(req.body))
			.digest("hex");
		return ledger.run(id, signature, action);
	};

	router.get(
		"/usage/codex",
		handle(async (_req, res) => {
			res.json(await codex.limits());
		}),
	);
	router.get(
		"/sessions",
		handle(async (_req, res) => {
			const titles = new Map(
				listClaudeSessions(100).map((s) => [s.sessionId, s]),
			);
			const sessions = [
				...claude
					.listSessions()
					.filter((s) => s.running)
					.map((s) => ({
						...s,
						provider: "claude",
						title: titles.get(s.sessionId ?? "")?.title ?? "Claude session",
					})),
				...codex.listSessions().map((s) => ({
					key: s.key,
					sessionId: s.threadId,
					provider: "codex",
					title: s.title || "Codex session",
					running: s.status === "working",
				})),
			];
			const history = [...titles.values()].map((s) => ({
				...s,
				provider: "claude" as MobileProvider,
			}));
			const warnings: string[] = [];
			let historyLoading = false;
			try {
				const recent = await recentCodexHistory();
				historyLoading = recent.pending;
				history.push(
					...recent.items.map((s) => ({
						...s,
						provider: "codex" as MobileProvider,
					})),
				);
			} catch {
				warnings.push(
					"Codex history is unavailable. Check Codex sign-in on the desktop.",
				);
			}
			res.json({ sessions, history, warnings, historyLoading });
		}),
	);
	router.post(
		"/new",
		handle(async (req, res) => {
			const body = z
				.object({
					provider: providerSchema,
					workspaceId: z.string(),
					requestId: z.string().uuid(),
				})
				.parse(req.body);
			res.json(
				await once(req, async () => {
					const target = listBridgeWorkspaceTargets().find(
						(s) => s.id === body.workspaceId,
					);
					if (!target)
						throw new Error("Choose a workspace that exists on this desktop.");
					const key = `mobile-${randomUUID()}`;
					if (body.provider === "codex") {
						const state = await codex.start({
							key,
							cwd: target.cwd,
							workspaceId: target.id,
						});
						if (state.error) throw new Error(state.error);
					} else claude.start(key, { cwd: target.cwd, workspaceId: target.id });
					return { key, provider: body.provider };
				}),
			);
		}),
	);
	router.post(
		"/resume",
		handle(async (req, res) => {
			const body = z
				.object({
					provider: providerSchema,
					sessionId: z.string().min(1).max(200),
					requestId: z.string().uuid(),
				})
				.parse(req.body);
			res.json(
				await once(req, async () => {
					const live =
						body.provider === "codex"
							? codex.listSessions().find((s) => s.threadId === body.sessionId)
							: claude
									.listSessions()
									.find((s) => s.sessionId === body.sessionId && s.running);
					if (live) {
						if (body.provider === "codex" && "error" in live && live.error) {
							const state = await codex.start({
								key: live.key,
								cwd: live.cwd,
								resumeSessionId: body.sessionId,
							});
							if (state.error) throw new Error(state.error);
						}
						return { key: live.key, provider: body.provider };
					}
					const summary =
						body.provider === "codex"
							? await codex.readSummary(body.sessionId)
							: listClaudeSessions(1_000).find(
									(s) => s.sessionId === body.sessionId,
								);
					if (!summary?.cwd)
						throw new Error(
							"This saved session has no available working folder.",
						);
					const key = `mobile-${randomUUID()}`;
					if (body.provider === "codex") {
						const state = await codex.start({
							key,
							cwd: summary.cwd,
							resumeSessionId: body.sessionId,
						});
						if (state.error) throw new Error(state.error);
					} else
						claude.start(key, {
							cwd: summary.cwd,
							resumeSessionId: body.sessionId,
						});
					return { key, provider: body.provider };
				}),
			);
		}),
	);
	router.get(
		"/:provider/:key",
		handle(async (req, res) => {
			const { provider, key } = providerKey(req);
			const before =
				typeof req.query.before === "string" ? req.query.before : undefined;
			if (provider === "codex") {
				const state = codexState(key);
				if (
					before &&
					state.historyCursor &&
					state.items.findIndex((i) => i.id === before) < 300
				)
					await codex.earlier(key);
				const current = codexState(key);
				const page = messagePage(
					current.items.map((item) => ({
						id: item.id,
						kind: item.kind,
						title: item.command || item.title,
						text:
							item.kind === "activity" ? item.text.slice(-16_000) : item.text,
						status: item.status,
						images: [
							...(item.images ?? []).map((source) => ({
								name: "Attached image",
								source,
							})),
							...(item.imagePaths ?? []).map((_path, index) => ({
								name: "Attached image",
								index,
							})),
						],
					})),
					before,
				);
				res.json({
					...page,
					hasEarlier: page.hasEarlier || !!current.historyCursor,
					provider,
					title: current.title || "Codex",
					working: current.status === "working" || current.status === "loading",
					error: current.error,
					questions: current.approvals,
					context: {
						contextTokens: current.contextTokens,
						contextWindow: current.contextWindow,
					},
				});
				return;
			}
			const timeline = claudeTimeline(key);
			const messages: MobileMessage[] = timeline.items.flatMap(
				(item): MobileMessage[] => {
					if (item.kind === "user")
						return [
							{
								id: item.id,
								kind: "user",
								text: item.text,
								images: item.attachments?.map((a) => ({
									name: a.name,
									source: a.thumbnail,
								})),
							},
						];
					if (item.kind === "text")
						return [{ id: item.id, kind: "assistant", text: item.text }];
					if (item.kind === "tool")
						return [
							{
								id: item.id,
								kind: "activity",
								title: item.name,
								text: `${JSON.stringify(item.input, null, 2)}\n${item.output ?? ""}`.slice(
									-16_000,
								),
								status: item.status,
							},
						];
					if (item.kind === "notice")
						return [{ id: item.id, kind: "notice", text: item.text }];
					return [];
				},
			);
			res.json({
				...messagePage(messages, before),
				provider,
				title: timeline.header?.model || "Claude",
				context: timeline.usage,
				working: claude.isRunning(key) && timeline.status === "streaming",
				questions: (timeline.permissions ?? []).map((p) => ({
					id: p.id,
					title: `Allow ${p.tool}?`,
					detail: JSON.stringify(p.input, null, 2),
					questions: [],
				})),
			});
		}),
	);
	router.get(
		"/codex/:key/image/:item/:index",
		handle(async (req, res) => {
			res.json(
				await codex.attachment(
					String(req.params.key),
					String(req.params.item),
					z.coerce.number().int().min(0).max(100).parse(req.params.index),
				),
			);
		}),
	);
	router.post(
		"/:provider/:key/send",
		handle(async (req, res) => {
			const { provider, key } = providerKey(req);
			const body = promptSchema.parse(req.body);
			res.json(
				await once(req, async () => {
					if (provider === "codex") {
						const state = codexState(key);
						await codex.send({
							key,
							text: body.text,
							model: state.model,
							effort: state.effort,
							permission: "default",
							images: body.images.map(
								(i) => `data:${i.mediaType};base64,${i.data}`,
							),
						});
					} else {
						if (!claude.isRunning(key))
							throw new Error(
								"Resume this session from History before sending.",
							);
						claude.send(key, body.text, false, body.images);
					}
					return { ok: true };
				}),
			);
		}),
	);
	router.post(
		"/:provider/:key/stop",
		handle(async (req, res) => {
			const { provider, key } = providerKey(req);
			if (provider === "codex") await codex.interrupt(key);
			else claude.interrupt(key);
			res.json({ ok: true });
		}),
	);
	router.post(
		"/:provider/:key/answer",
		handle(async (req, res) => {
			const { provider, key } = providerKey(req);
			const body = z
				.object({
					id: z.string(),
					allow: z.boolean(),
					answers: z.record(z.string(), z.string().max(20_000)).optional(),
				})
				.parse(req.body);
			if (provider === "codex") {
				const pending = codexState(key).approvals.find((p) => p.id === body.id);
				if (!pending)
					throw new Error("This question has already been answered.");
				if (pending.questions.some((q) => !body.answers?.[q.id]?.trim()))
					throw new Error("Answer every question first.");
				await codex.answer(key, body.id, body.allow, body.answers);
			} else {
				if (!claudeTimeline(key).permissions?.some((p) => p.id === body.id))
					throw new Error("This permission request has already been answered.");
				claude.answerPermission(key, body.id, body.allow);
			}
			res.json({ ok: true });
		}),
	);
	return router;
}
