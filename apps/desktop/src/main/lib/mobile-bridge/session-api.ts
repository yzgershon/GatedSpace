import { createHash, randomUUID } from "node:crypto";
import { hostname, platform } from "node:os";
import express from "express";
import { z } from "zod";
import {
	parseClaudeQuestions,
	validateClaudeQuestionAnswers,
} from "../../../shared/claude-session/questions";
import { buildTimeline } from "../../../shared/claude-session/timeline";
import { defaultCodexPermission } from "../../../shared/codex-session/permissions";
import { claudeSessionManager as claude } from "../claude-session/session-manager";
import { loadSessionTranscript } from "../claude-session/transcript";
import { listClaudeSessions } from "../claude-sessions/claude-sessions";
import { codexSessionManager as codex } from "../codex-session/session-manager";
import { sessionNames } from "../session-names";
import { mobileActivityTitle, mobileMarkdown } from "./message-format";
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
const timelines = new Map<
	string,
	{
		stored: unknown;
		last: unknown;
		length: number;
		value: ReturnType<typeof buildTimeline>;
	}
>();
function claudeWorking(key: string) {
	if (!claude.isRunning(key) || !claude.isBusy(key)) return false;
	// A late stream frame can arrive after the completed result. Process liveness
	// and those trailing frames must not keep a finished turn spinning on mobile.
	for (const event of [...claude.getBufferedEvents(key)].reverse()) {
		if (event.type === "local_user_message") return true;
		if (
			event.type === "result" ||
			(event.type === "local_notice" && event.fatal)
		)
			return false;
	}
	return true;
}
function presentedPage(messages: MobileMessage[], before?: string) {
	const page = messagePage(messages, before);
	return {
		...page,
		messages: page.messages.map((item) =>
			item.kind === "assistant"
				? { ...item, html: mobileMarkdown(item.text) }
				: item,
		),
	};
}
async function claudeTimeline(key: string) {
	const session = claude.listSessions().find((s) => s.key === key);
	if (!session)
		throw new Error("This session is no longer open. Reopen it from History.");
	let stored = session.sessionId
		? transcripts.get(session.sessionId)
		: undefined;
	if (session.sessionId && (!stored || Date.now() - stored.at > 15_000)) {
		stored = {
			at: Date.now(),
			events: loadSessionTranscript(session.sessionId),
		};
		if (transcripts.size >= 12)
			transcripts.delete(transcripts.keys().next().value ?? "");
		transcripts.set(session.sessionId, stored);
	}
	const events = (await stored?.events) ?? [];
	const buffer = claude.getBufferedEvents(key);
	const cached = timelines.get(key);
	if (
		cached &&
		cached.stored === stored?.events &&
		cached.last === buffer.at(-1) &&
		cached.length === buffer.length
	)
		return cached.value;
	const value = buildTimeline(mergeTranscriptWithBuffer(events, buffer));
	if (timelines.size >= 12)
		timelines.delete(timelines.keys().next().value ?? "");
	timelines.set(key, {
		stored: stored?.events,
		last: buffer.at(-1),
		length: buffer.length,
		value,
	});
	return value;
}

function codexState(key: string) {
	const state = codex.get(key);
	if (!state)
		throw new Error("This session is no longer open. Reopen it from History.");
	return state;
}

export function mobileSessionRouter() {
	const router = express.Router();
	router.use((_req, res, next) => {
		res.setHeader("Cache-Control", "no-store");
		next();
	});
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
	const once = <T>(
		req: express.Request,
		action: () => Promise<T>,
		validate?: () => void,
	) => {
		const id = z.string().uuid().parse(req.body?.requestId);
		const signature = createHash("sha256")
			.update(req.path)
			.update(JSON.stringify(req.body))
			.digest("hex");
		return ledger.run(id, signature, action, validate);
	};

	router.get(
		"/computer",
		handle(async (_req, res) => {
			res.json({
				name: hostname(),
				platform: platform(),
				connected: true,
				execution: "desktop",
				browserHandoff: false,
				cloudAvailable: false,
				workspaces: listBridgeWorkspaceTargets().map(
					({ id, name, project }) => ({ id, name, project }),
				),
			});
		}),
	);
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
						running: claudeWorking(s.key),
						provider: "claude",
						lastModified: titles.get(s.sessionId ?? "")?.lastModified ?? 0,
						title:
							sessionNames.get({
								provider: "claude",
								key: s.key,
								id: s.sessionId ?? undefined,
							}) ??
							titles.get(s.sessionId ?? "")?.title ??
							"Claude session",
					})),
				...codex.listSessions().map((s) => ({
					key: s.key,
					sessionId: s.threadId,
					provider: "codex",
					lastModified: s.items.reduce(
						(latest, item) =>
							Math.max(latest, item.startedAt ?? 0, item.completedAt ?? 0),
						0,
					),
					title:
						sessionNames.get({
							provider: "codex",
							key: s.key,
							id: s.threadId ?? undefined,
						}) ??
						s.title ??
						"Codex session",
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
						title:
							sessionNames.get({ provider: "codex", id: s.sessionId }) ??
							s.title,
						provider: "codex" as MobileProvider,
					})),
				);
			} catch {
				warnings.push(
					"Codex history is unavailable. Check Codex sign-in on the desktop.",
				);
			}
			const historyTimes = new Map(
				history.map((s) => [
					`${s.provider}:${s.sessionId}`,
					s.lastModified ?? 0,
				]),
			);
			res.json({
				sessions: sessions.map((s) => ({
					...s,
					lastModified: Math.max(
						s.lastModified,
						historyTimes.get(`${s.provider}:${s.sessionId}`) ?? 0,
					),
				})),
				history,
				warnings,
				historyLoading,
			});
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
					state.items.findIndex((i) => i.id === before) < 60
				)
					await codex.earlier(key);
				const current = codexState(key);
				const page = presentedPage(
					current.items.map((item) => ({
						id: item.id,
						kind: item.kind,
						title: mobileActivityTitle(item),
						text: item.kind === "activity" ? "" : item.text,
						detailAvailable: item.kind === "activity",
						status: item.status,
						images: [
							...(item.images ?? []).map((_source, index) => ({
								name: "Attached image",
								index,
							})),
							...(item.imagePaths ?? []).map((_path, index) => ({
								name: "Attached image",
								index: (item.images?.length ?? 0) + index,
							})),
						],
					})),
					before,
				);
				res.json({
					...page,
					sessionId: current.threadId,
					hasEarlier: page.hasEarlier || !!current.historyCursor,
					provider,
					title:
						sessionNames.get({
							provider: "codex",
							key,
							id: current.threadId ?? undefined,
						}) ??
						current.title ??
						"Codex",
					working: current.status === "working",
					loading: current.status === "loading",
					error: current.error,
					questions: current.approvals,
					context: {
						contextTokens: current.contextTokens,
						contextWindow: current.contextWindow,
					},
				});
				return;
			}
			const timeline = await claudeTimeline(key);
			const messages: MobileMessage[] = timeline.items.flatMap(
				(item): MobileMessage[] => {
					if ("parentToolUseId" in item && item.parentToolUseId) return [];
					if (item.kind === "user")
						return [
							{
								id: item.id,
								kind: "user",
								text: item.text,
								images: item.attachments?.map((a, index) => ({
									name: a.name,
									index: a.thumbnail ? index : undefined,
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
								text: "",
								detailAvailable: true,
								status: item.status,
							},
						];
					if (item.kind === "notice")
						return [{ id: item.id, kind: "notice", text: item.text }];
					return [];
				},
			);
			res.json({
				...presentedPage(messages, before),
				sessionId: claude.listSessions().find((s) => s.key === key)?.sessionId,
				provider,
				title:
					sessionNames.get({
						provider: "claude",
						key,
						id:
							claude.listSessions().find((s) => s.key === key)?.sessionId ??
							undefined,
					}) ?? "Claude",
				context: timeline.usage,
				working: claudeWorking(key),
				questions: (timeline.permissions ?? []).map((p) => ({
					id: p.id,
					title:
						p.tool === "AskUserQuestion"
							? "Claude has a question"
							: `Allow ${p.tool}?`,
					detail: JSON.stringify(p.input, null, 2),
					questions:
						p.tool === "AskUserQuestion"
							? (parseClaudeQuestions(p.input) ?? []).map((q) => ({
									id: q.question,
									question: q.question,
									options: q.options.map((o) => o.label),
									descriptions: q.options.map((o) => o.description),
									multiSelect: q.multiSelect,
								}))
							: [],
				})),
			});
		}),
	);
	router.get(
		"/:provider/:key/activity/:item",
		handle(async (req, res) => {
			const { provider, key } = providerKey(req);
			if (provider === "codex") {
				const item = codexState(key).items.find(
					(i) => i.id === req.params.item && i.kind === "activity",
				);
				if (!item) throw new Error("This activity is no longer available.");
				res.json({
					text: [item.command, item.input, item.text]
						.filter(Boolean)
						.join("\n")
						.slice(-16_000),
				});
			} else {
				const item = (await claudeTimeline(key)).items.find(
					(i) => i.id === req.params.item && i.kind === "tool",
				);
				if (item?.kind !== "tool")
					throw new Error("This activity is no longer available.");
				res.json({
					text: `${JSON.stringify(item.input, null, 2)}\n${item.output ?? ""}`.slice(
						-16_000,
					),
				});
			}
		}),
	);
	router.get(
		"/:provider/:key/image/:item/:index",
		handle(async (req, res) => {
			const { provider, key } = providerKey(req);
			const index = z.coerce
				.number()
				.int()
				.min(0)
				.max(100)
				.parse(req.params.index);
			if (provider === "claude") {
				const item = (await claudeTimeline(key)).items.find(
					(i) => i.id === req.params.item,
				);
				const attachment =
					item?.kind === "user" ? item.attachments?.[index] : undefined;
				if (!attachment?.thumbnail)
					throw new Error("This image is no longer available.");
				res.json({ source: attachment.thumbnail, name: attachment.name });
			} else {
				const item = codexState(key).items.find(
					(i) => i.id === req.params.item,
				);
				if (item?.images?.[index])
					res.json({ source: item.images[index], name: "Attached image" });
				else
					res.json(
						await codex.attachment(
							key,
							String(req.params.item),
							index - (item?.images?.length ?? 0),
						),
					);
			}
		}),
	);
	router.post(
		"/:provider/:key/send",
		handle(async (req, res) => {
			const { provider, key } = providerKey(req);
			const body = promptSchema.parse(req.body);
			const validateSend = () => {
				if (provider !== "claude") return;
				if (!claude.isRunning(key))
					throw new Error("Resume this session from History before sending.");
			};
			res.json(
				await once(
					req,
					async () => {
						if (provider === "codex") {
							const state = codexState(key);
							await codex.send({
								key,
								text: body.text,
								steerIfWorking: true,
								model: state.model,
								effort: state.effort,
								permission: state.permission ?? defaultCodexPermission(),
								images: body.images.map(
									(i) => `data:${i.mediaType};base64,${i.data}`,
								),
							});
						} else {
							validateSend();
							claude.send(key, body.text, false, body.images);
						}
						return { ok: true };
					},
					validateSend,
				),
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
				if (
					body.allow &&
					pending.questions.some((q) => !body.answers?.[q.id]?.trim())
				)
					throw new Error("Answer every question first.");
				await codex.answer(key, body.id, body.allow, body.answers);
			} else {
				const pending = buildTimeline(
					claude.getBufferedEvents(key),
				).permissions?.find((p) => p.id === body.id);
				if (!pending)
					throw new Error("This permission request has already been answered.");
				if (body.allow && pending.tool === "AskUserQuestion")
					validateClaudeQuestionAnswers(pending.input, body.answers);
				claude.answerPermission(key, body.id, body.allow, body.answers);
			}
			res.json({ ok: true });
		}),
	);
	return router;
}
