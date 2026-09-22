import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { basename } from "node:path";
import {
	defaultCodexEffort,
	mentionedSkills,
	normalizeCodexLimits,
	normalizeCodexSkills,
} from "../../../shared/codex-session/controls";
import {
	type CodexItem,
	type CodexModel,
	type CodexPermission,
	type CodexSessionState,
	finiteNumber,
	list,
	normalizeCodexItem,
	record,
	text,
} from "../../../shared/codex-session/types";
import {
	agentBrowserService,
	browserInstructions,
} from "../browser/agent-browser-service";
import { resolveCodexProject } from "./projects";
import { CodexRpcError, CodexTransport } from "./transport";

export interface StartCodexSession {
	workspaceId?: string;
	key: string;
	cwd: string;
	model?: string;
	resumeSessionId?: string;
	forkSession?: boolean;
}

export class CodexSessionManager extends EventEmitter {
	private sessions = new Map<string, CodexSessionState>();
	private starts = new Map<string, Promise<CodexSessionState>>();
	private turnStarts = new Map<string, Promise<unknown>>();
	private claims = new Map<string, string>();
	private requests = new Map<
		string,
		{ id: string | number; key: string; method: string }
	>();
	private timers = new Map<string, ReturnType<typeof setTimeout>>();
	constructor(readonly transport = new CodexTransport()) {
		super();
		transport.on("notification", (message) =>
			this.notification(record(message)),
		);
		transport.on("request", (message) => this.approval(record(message)));
		transport.on("disconnected", (error: Error) => {
			for (const state of this.sessions.values()) {
				state.status = "error";
				state.error = error.message;
				state.approvals = [];
				this.finishActivity(state, "failed");
				this.publish(state);
			}
			this.requests.clear();
		});
	}
	get(key: string) {
		return this.sessions.get(key);
	}
	liveIds() {
		return [...this.sessions.values()].flatMap((s) =>
			s.threadId ? [s.threadId] : [],
		);
	}
	private publish(state: CodexSessionState) {
		if (this.timers.has(state.key)) return;
		this.timers.set(
			state.key,
			setTimeout(() => {
				this.timers.delete(state.key);
				this.emit(state.key, state);
			}, 32),
		);
	}
	async models(): Promise<CodexModel[]> {
		const models: CodexModel[] = [];
		let cursor: string | null = null;
		do {
			const page = record(
				await this.transport.request("model/list", { cursor, limit: 100 }),
			);
			for (const value of list(page.data)) {
				const m = record(value);
				if (m.hidden) continue;
				models.push({
					id: text(m.model) || text(m.id),
					name: text(m.displayName),
					defaultEffort: text(m.defaultReasoningEffort),
					efforts: list(m.supportedReasoningEfforts)
						.map((e) => text(record(e).reasoningEffort))
						.filter(Boolean),
				});
			}
			cursor = text(page.nextCursor) || null;
		} while (cursor);
		return models;
	}
	async account() {
		const result = record(
			await this.transport.request("account/read", { refreshToken: false }),
		);
		const account = record(result.account);
		return {
			signedIn: Boolean(result.account),
			label: text(account.email) || text(account.type),
			plan: text(account.planType),
		};
	}
	async limits(model?: string) {
		return normalizeCodexLimits(
			await this.transport.request("account/rateLimits/read"),
			model,
		);
	}
	async skills(cwd: string) {
		return normalizeCodexSkills(
			await this.transport.request("skills/list", { cwds: [cwd] }),
		);
	}
	async listThreads(limit: number, searchTerm?: string) {
		const rows: Record<string, unknown>[] = [];
		let cursor: string | null = null;
		do {
			const page = record(
				await this.transport.request("thread/list", {
					limit: Math.min(100, limit - rows.length),
					cursor,
					archived: false,
					sortKey: "updated_at",
					sortDirection: "desc",
					...(searchTerm ? { searchTerm } : {}),
				}),
			);
			rows.push(...list(page.data).map(record));
			cursor = text(page.nextCursor) || null;
		} while (cursor && rows.length < limit);
		return rows.map((t) => ({
			sessionId: text(t.id),
			title:
				text(t.name) ||
				text(t.preview).split("\n")[0]?.slice(0, 120) ||
				"Codex session",
			cwd: text(t.cwd) || null,
			projectDirName: basename(text(t.cwd)),
			sizeBytes: 0,
			contextTokens: null,
			lastModified: Number(t.updatedAt) * 1000,
			filePath: text(t.path),
			firstMessage: text(t.preview),
		}));
	}
	async rename(threadId: string, name: string) {
		await this.transport.request("thread/name/set", { threadId, name });
	}
	async readSummary(threadId: string) {
		const thread = record(
			record(
				await this.transport.request("thread/read", {
					threadId,
					includeTurns: false,
				}),
			).thread,
		);
		if (text(thread.id) !== threadId)
			throw new Error("The saved Codex session could not be found.");
		return {
			sessionId: threadId,
			title:
				text(thread.name) ||
				text(thread.preview).split("\n")[0]?.slice(0, 120) ||
				"Codex session",
			cwd: text(thread.cwd) || null,
			lastModified: Number(thread.updatedAt) * 1000,
		};
	}
	async archive(threadId: string) {
		if (this.liveIds().includes(threadId))
			throw new Error("Close this Codex session before archiving it.");
		await this.transport.request("thread/archive", { threadId });
	}
	start(input: StartCodexSession): Promise<CodexSessionState> {
		const pending = this.starts.get(input.key);
		if (pending) return pending;
		const existing = this.get(input.key);
		if (existing && existing.status !== "error")
			return Promise.resolve(existing);
		const started = this.open(input).finally(() =>
			this.starts.delete(input.key),
		);
		this.starts.set(input.key, started);
		return started;
	}
	private async open(input: StartCodexSession): Promise<CodexSessionState> {
		if (input.workspaceId)
			agentBrowserService.register(`codex:${input.key}`, input.workspaceId);
		const previous = this.get(input.key);
		const id = previous?.threadId || input.resumeSessionId;
		const state: CodexSessionState = {
			key: input.key,
			threadId: previous?.threadId ?? null,
			cwd: input.cwd,
			title: "Codex",
			model: input.model ?? "",
			effort: previous?.effort || "xhigh",
			status: "loading",
			turnId: null,
			items: previous?.items ?? [],
			approvals: [],
			error: null,
			historyCursor: null,
			diff: "",
			contextTokens: null,
			contextWindow: null,
			turns: previous?.turns ?? [],
		};
		this.sessions.set(input.key, state);
		this.publish(state);
		try {
			if (id && !input.forkSession) {
				const owned = [...this.sessions.values()].find(
					(s) => s.key !== input.key && s.threadId === id,
				);
				if (owned || (this.claims.has(id) && this.claims.get(id) !== input.key))
					throw new Error(
						"This conversation is already open in GatedSpace. Return to its pane or open a fork.",
					);
				this.claims.set(id, input.key);
				const metadata = record(
					record(
						await this.transport
							.request("thread/read", { threadId: id })
							.catch((error) => {
								// Some app-server versions only read threads already loaded in
								// this process. Resume below loads the saved thread from disk.
								if (
									error instanceof CodexRpcError &&
									/thread not loaded/i.test(error.message)
								)
									return {};
								throw error;
							}),
					).thread,
				);
				if (record(metadata.status).type === "active")
					throw new Error(
						"This Codex conversation is still working in another client. Wait for it to finish or open a fork.",
					);
			}
			const models = await this.models();
			const selected =
				input.model ||
				previous?.model ||
				models.find((m) => m.id === "gpt-6-astra")?.id;
			const effort =
				previous?.effort ||
				defaultCodexEffort(models.find((m) => m.id === selected));
			const projectId =
				!id || input.forkSession ? await this.project(input.cwd) : undefined;
			const result = record(
				await this.transport.request(
					id
						? input.forkSession
							? "thread/fork"
							: "thread/resume"
						: "thread/start",
					{
						...(input.workspaceId
							? {
									developerInstructions: browserInstructions(
										`codex:${input.key}`,
									),
								}
							: {}),
						config: { model_reasoning_effort: effort },
						...(projectId ? { projectId } : {}),
						...(id
							? { threadId: id, excludeTurns: true }
							: { cwd: input.cwd, ...(selected ? { model: selected } : {}) }),
					},
				),
			);
			const thread = record(result.thread);
			state.threadId = text(thread.id);
			if (!state.threadId)
				throw new Error("Codex returned no conversation ID.");
			state.cwd = text(thread.cwd) || input.cwd;
			if (id && !text(thread.projectId)) {
				const targetProject = projectId || (await this.project(state.cwd));
				if (targetProject)
					await this.transport
						.request("thread/metadata/update", {
							threadId: state.threadId,
							projectId: targetProject,
						})
						.catch((error) =>
							console.warn(
								"[codex-session] Project association unavailable",
								error,
							),
						);
			}
			state.title =
				text(thread.name) ||
				text(thread.preview).split("\n")[0]?.slice(0, 80) ||
				"Codex";
			state.model = text(result.model) || text(thread.model) || selected || "";
			state.effort = effort;
			if (id) await this.history(state, false, list(thread.turns));
			state.status = "idle";
			this.publish(state);
			return state;
		} catch (error) {
			state.status = "error";
			state.error = error instanceof Error ? error.message : String(error);
			this.publish(state);
			throw error;
		} finally {
			if (id && this.claims.get(id) === input.key) this.claims.delete(id);
		}
	}
	private async project(cwd: string) {
		try {
			return await resolveCodexProject(
				(method, params) => this.transport.request(method, params),
				cwd,
			);
		} catch (error) {
			// Older CLIs do not expose projects; their sessions still remain usable.
			console.warn("[codex-session] Project lookup unavailable", error);
			return undefined;
		}
	}

	private async history(
		state: CodexSessionState,
		earlier: boolean,
		legacyTurns: unknown[] = [],
	) {
		for (const turn of legacyTurns) this.rememberTurn(state, turn);
		try {
			const page = record(
				await this.transport.request("thread/items/list", {
					threadId: state.threadId,
					limit: 100,
					sortDirection: "desc",
					cursor: earlier ? state.historyCursor : null,
				}),
			);
			const items = list(page.data)
				.map((v) => {
					const e = record(v);
					return normalizeCodexItem(e.item, text(e.turnId));
				})
				.filter((v): v is CodexItem => v !== null)
				.reverse();
			state.items = earlier
				? [
						...items,
						...state.items.filter((v) => !items.some((i) => i.id === v.id)),
					]
				: items;
			state.historyCursor = text(page.nextCursor) || null;
		} catch (error) {
			if (
				!(error instanceof CodexRpcError) ||
				(error.code !== -32601 &&
					!/not supported yet|not implemented/i.test(error.message))
			)
				throw error;
			const turns = legacyTurns.length
				? legacyTurns
				: list(
						record(
							record(
								await this.transport.request("thread/read", {
									threadId: state.threadId,
									includeTurns: true,
								}),
							).thread,
						).turns,
					);
			state.items = turns.flatMap((v) => {
				const turn = record(v);
				this.rememberTurn(state, turn);
				return list(turn.items)
					.map((i) => normalizeCodexItem(i, text(turn.id)))
					.filter((i): i is CodexItem => i !== null);
			});
			state.historyCursor = null;
		}
	}
	async earlier(key: string) {
		const state = this.require(key);
		if (state.historyCursor) await this.history(state, true);
		this.publish(state);
		return state;
	}
	private require(key: string) {
		const state = this.get(key);
		if (!state?.threadId)
			throw new Error("Connect Codex before sending a message.");
		return state;
	}
	async send(input: {
		key: string;
		text: string;
		model: string;
		effort: string;
		permission: CodexPermission;
		plan?: boolean;
		fast?: boolean;
		images?: string[];
	}) {
		const state = this.require(input.key);
		if (state.status !== "idle")
			throw new Error(
				"Wait for this turn to finish or stop it before sending another message.",
			);
		state.error = null;
		state.status = "working";
		state.workingSince = Date.now();
		state.diff = "";
		// The app-server can acknowledge a turn long before echoing its user item.
		// Keep the submitted prompt in the main-process snapshot across tab switches.
		const optimistic: CodexItem = {
			id: `local-user-${randomUUID()}`,
			turnId: "",
			kind: "user",
			title: "User message",
			text: [input.text, ...(input.images ?? []).map(() => "[Attached image]")]
				.filter(Boolean)
				.join("\n\n"),
			startedAt: state.workingSince,
		};
		state.items.push(optimistic);
		this.publish(state);
		try {
			const skills = /(?:^|\s)\$[\w.:-]+/.test(input.text)
				? mentionedSkills(input.text, await this.skills(state.cwd))
				: [];
			const permissions =
				input.permission === "full-access"
					? {
							approvalPolicy: "never",
							sandboxPolicy: { type: "dangerFullAccess" },
						}
					: input.permission === "read-only"
						? {
								approvalPolicy: "on-request",
								sandboxPolicy: { type: "readOnly" },
							}
						: {
								approvalPolicy: "on-request",
								sandboxPolicy: {
									type: "workspaceWrite",
									writableRoots: [state.cwd],
									networkAccess: false,
									excludeTmpdirEnvVar: false,
									excludeSlashTmp: false,
								},
							};
			const started = this.transport.request("turn/start", {
				threadId: state.threadId,
				input: [
					{ type: "text", text: input.text, text_elements: [] },
					...skills,
					...(input.images ?? []).map((url) => ({ type: "image", url })),
				],
				...(input.model ? { model: input.model } : {}),
				...(input.effort ? { effort: input.effort } : {}),
				...permissions,
				serviceTier: input.fast ? "fast" : "default",
				collaborationMode: {
					mode: input.plan ? "plan" : "default",
					settings: {
						model: input.model || state.model,
						reasoning_effort: input.effort || state.effort,
						developer_instructions: null,
					},
				},
			});
			this.turnStarts.set(input.key, started);
			const result = record(await started);
			const startedId = text(record(result.turn).id);
			if (state.status === "working") state.turnId = startedId || state.turnId;
			this.rememberTurn(state, result.turn, "inProgress");
			optimistic.turnId ||= startedId || state.turnId || "";
			for (const item of list(record(result.turn).items))
				this.upsert(state, item, optimistic.turnId);
			state.model = input.model;
			state.effort = input.effort;
			this.publish(state);
		} catch (error) {
			// A rejected turn remains in the composer for retry, not as a sent message.
			state.items = state.items.filter((item) => item.id !== optimistic.id);
			state.status = /thread not loaded|connection closed|not connected/i.test(
				error instanceof Error ? error.message : String(error),
			)
				? "error"
				: "idle";
			state.error = error instanceof Error ? error.message : String(error);
			this.finishActivity(state, "failed");
			this.publish(state);
			throw error;
		} finally {
			this.turnStarts.delete(input.key);
		}
	}
	async interrupt(key: string) {
		// Stop/close can arrive before turn/start has returned its turn ID.
		await this.turnStarts.get(key)?.catch(() => {});
		const state = this.require(key);
		if (state.turnId)
			await this.transport.request("turn/interrupt", {
				threadId: state.threadId,
				turnId: state.turnId,
			});
	}
	async command(key: string, command: "review" | "compact", args?: string) {
		const state = this.require(key);
		if (state.status !== "idle")
			throw new Error("Wait for Codex to finish before running this command.");
		state.status = "working";
		state.error = null;
		state.workingSince = Date.now();
		this.publish(state);
		try {
			const started = this.transport.request(
				command === "review" ? "review/start" : "thread/compact/start",
				command === "review"
					? {
							threadId: state.threadId,
							target: args
								? { type: "custom", instructions: args }
								: { type: "uncommittedChanges" },
							delivery: "inline",
						}
					: { threadId: state.threadId },
			);
			this.turnStarts.set(key, started);
			const result = record(await started);
			if (state.status === "working")
				state.turnId = text(record(result.turn).id) || state.turnId;
			this.rememberTurn(state, result.turn, "inProgress");
			this.publish(state);
		} catch (error) {
			state.status = "idle";
			state.error = error instanceof Error ? error.message : String(error);
			this.finishActivity(state, "failed");
			this.publish(state);
			throw error;
		} finally {
			this.turnStarts.delete(key);
		}
	}
	private notification(message: Record<string, unknown>) {
		const method = text(message.method);
		const p = record(message.params);
		const threadId = text(p.threadId) || text(record(p.thread).id);
		const state = [...this.sessions.values()].find(
			(s) => s.threadId === threadId,
		);
		if (!state) return;
		const turnId = text(p.turnId) || state.turnId || "";
		if (method === "turn/started") {
			state.turnId = text(record(p.turn).id);
			state.status = "working";
			state.workingSince ??= Date.now();
			this.rememberTurn(state, p.turn, "inProgress");
			const pending = state.items.find(
				(item) => item.id.startsWith("local-user-") && !item.turnId,
			);
			if (pending) pending.turnId = state.turnId || "";
			for (const item of list(record(p.turn).items))
				this.upsert(state, item, state.turnId || "");
		}
		if (method === "turn/completed") {
			const turn = record(p.turn);
			for (const item of list(turn.items))
				this.upsert(state, item, text(turn.id) || turnId, "completed");
			this.rememberTurn(
				state,
				{ ...turn, id: text(turn.id) || turnId },
				text(turn.status) || "completed",
			);
			this.finishActivity(state, text(turn.status) || "completed");
			state.status = "idle";
			state.turnId = null;
			state.error =
				text(record(turn.error).message) ||
				(turn.status === "interrupted"
					? "Stopped. You can continue below."
					: null);
			state.approvals = [];
			for (const [id, request] of this.requests) {
				if (request.key === state.key) this.requests.delete(id);
			}
		}
		if (method === "error") {
			state.error = text(record(p.error).message) || text(p.message);
			if (!p.willRetry) {
				this.finishActivity(state, "failed");
				state.status = "idle";
				state.turnId = null;
			}
		}
		if (method === "thread/name/updated")
			state.title = text(p.threadName) || state.title;
		if (method === "turn/diff/updated") state.diff = text(p.diff);
		if (method === "thread/tokenUsage/updated") {
			const usage = record(p.tokenUsage);
			const last = record(usage.last);
			state.contextTokens = Number(last.totalTokens) || null;
			state.contextWindow = Number(usage.modelContextWindow) || null;
		}
		if (method === "item/started" || method === "item/completed") {
			this.upsert(
				state,
				p.item,
				turnId,
				method === "item/started" ? "inProgress" : "completed",
			);
		}
		const deltaTypes: Record<string, string> = {
			"item/agentMessage/delta": "agentMessage",
			"item/commandExecution/outputDelta": "commandExecution",
			"item/reasoning/summaryTextDelta": "reasoning",
			"item/plan/delta": "plan",
			"item/fileChange/outputDelta": "fileChange",
		};
		const deltaType = deltaTypes[method];
		if (deltaType) {
			const itemId = text(p.itemId);
			let item = state.items.find((i) => i.id === itemId);
			if (!item && itemId) {
				this.upsert(
					state,
					{ id: itemId, type: deltaType },
					turnId,
					"inProgress",
				);
				item = state.items.find((i) => i.id === itemId);
			}
			if (item && !item.completedAt) item.text += text(p.delta);
		}
		if (
			method === "item/reasoning/summaryPartAdded" ||
			method === "item/mcpToolCall/progress"
		) {
			const item = state.items.find((i) => i.id === p.itemId);
			if (item && !item.completedAt)
				item.text += method.endsWith("progress")
					? `${item.text ? "\n" : ""}${text(p.message)}`
					: item.text
						? "\n\n"
						: "";
		}
		this.publish(state);
	}
	private rememberTurn(
		state: CodexSessionState,
		value: unknown,
		fallback?: string,
	) {
		const turn = record(value);
		const id = text(turn.id);
		if (!id) return;
		state.turns ??= [];
		const turns = state.turns;
		const previous = turns.find((t) => t.id === id);
		// A delayed turn/start response must not reopen a completed turn.
		if (previous?.completedAt && fallback === "inProgress") return;
		const status = text(turn.status) || fallback || "completed";
		const start = finiteNumber(turn.startedAt);
		const end = finiteNumber(turn.completedAt);
		const next = {
			id,
			status,
			startedAt:
				start !== undefined
					? start * 1000
					: (previous?.startedAt ??
						(fallback ? state.workingSince : undefined)),
			completedAt:
				end !== undefined
					? end * 1000
					: (previous?.completedAt ??
						(fallback && status !== "inProgress" ? Date.now() : undefined)),
			durationMs: finiteNumber(turn.durationMs) ?? previous?.durationMs,
		};
		if (previous) Object.assign(previous, next);
		else turns.push(next);
	}
	private finishActivity(state: CodexSessionState, status: string) {
		if (state.turnId)
			this.rememberTurn(state, { id: state.turnId, status }, status);
		for (const item of state.items) {
			if (item.status !== "inProgress") continue;
			item.status = status;
			item.completedAt ??= Date.now();
		}
		state.workingSince = undefined;
	}
	private upsert(
		state: CodexSessionState,
		value: unknown,
		turnId: string,
		lifecycle?: string,
	) {
		const item = normalizeCodexItem(value, turnId);
		if (!item) return;
		let index = state.items.findIndex((entry) => entry.id === item.id);
		if (index < 0 && item.kind === "user") {
			index = state.items.findIndex(
				(entry) =>
					entry.id.startsWith("local-user-") &&
					(entry.turnId === turnId ||
						(!entry.turnId && state.status === "working")) &&
					entry.text === item.text,
			);
		}
		const previous = index < 0 ? undefined : state.items[index];
		if (previous?.completedAt && lifecycle === "inProgress") return;
		item.status ||= lifecycle;
		item.startedAt =
			previous?.startedAt ??
			(lifecycle === "inProgress" ? Date.now() : undefined);
		item.completedAt =
			previous?.completedAt ??
			(lifecycle === "completed" ? Date.now() : undefined);
		if (previous && !item.text) item.text = previous.text;
		if (index < 0) state.items.push(item);
		else state.items[index] = item;
	}
	private approval(message: Record<string, unknown>) {
		const p = record(message.params);
		const method = text(message.method);
		const id = message.id;
		if (typeof id !== "string" && typeof id !== "number") return;
		const state = [...this.sessions.values()].find(
			(s) => s.threadId === p.threadId,
		);
		const supported = [
			"item/commandExecution/requestApproval",
			"item/fileChange/requestApproval",
			"item/tool/requestUserInput",
		];
		if (!state || !supported.includes(method)) {
			this.transport.reject(
				id,
				`GatedSpace does not support this request: ${method}`,
			);
			return;
		}
		const token = `${typeof id}:${id}`;
		this.requests.set(token, { id, key: state.key, method });
		state.approvals.push({
			id: token,
			method,
			title: method.endsWith("requestUserInput")
				? "Codex needs your input"
				: "Approval needed",
			detail:
				text(p.reason) ||
				text(p.command) ||
				"Allow Codex to make the requested change?",
			questions: list(p.questions).map((v) => {
				const q = record(v);
				return {
					id: text(q.id),
					question: text(q.question),
					options: list(q.options).map((o) => text(record(o).label)),
				};
			}),
		});
		this.publish(state);
	}
	answer(
		key: string,
		id: string,
		allow: boolean,
		answers?: Record<string, string>,
	) {
		const pending = this.requests.get(id);
		if (!pending || pending.key !== key)
			throw new Error("This request is no longer pending.");
		const state = this.require(key);
		const result = pending.method.endsWith("requestUserInput")
			? {
					answers: Object.fromEntries(
						Object.entries(answers ?? {}).map(([name, answer]) => [
							name,
							{ answers: [answer] },
						]),
					),
				}
			: { decision: allow ? "accept" : "decline" };
		this.transport.respond(pending.id, result);
		this.requests.delete(id);
		state.approvals = state.approvals.filter((a) => a.id !== id);
		this.publish(state);
	}
	async close(key: string) {
		await this.starts.get(key)?.catch(() => {});
		const state = this.get(key);
		if (!state) return;
		if (state.status === "working") await this.interrupt(key).catch(() => {});
		for (const [id, request] of this.requests)
			if (request.key === key) {
				this.transport.reject(request.id, "Pane closed");
				this.requests.delete(id);
			}
		this.sessions.delete(key);
		agentBrowserService.unregister(`codex:${key}`);
		clearTimeout(this.timers.get(key));
		this.timers.delete(key);
		if (state.threadId)
			await this.transport
				.request("thread/unsubscribe", { threadId: state.threadId })
				.catch(() => {});
	}
	dispose() {
		for (const key of this.sessions.keys())
			agentBrowserService.unregister(`codex:${key}`);
		for (const timer of this.timers.values()) clearTimeout(timer);
		this.timers.clear();
		this.transport.dispose();
	}
}

export const codexSessionManager = new CodexSessionManager();
