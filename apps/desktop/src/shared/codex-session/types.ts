/** GatedSpace's renderer contract, independent of a particular Codex CLI version. */
export interface CodexItem {
	id: string;
	turnId: string;
	kind: "user" | "assistant" | "activity";
	title: string;
	text: string;
	status?: string;
	phase?: string;
	activityType?: string;
	command?: string;
	cwd?: string;
	tool?: string;
	input?: string;
	url?: string;
	images?: string[];
	changes?: { path: string; diff: string; kind: string }[];
	exitCode?: number;
	durationMs?: number;
	startedAt?: number;
	completedAt?: number;
}
export interface CodexTurn {
	id: string;
	status: string;
	startedAt?: number;
	completedAt?: number;
	durationMs?: number;
}
export interface CodexQuestion {
	id: string;
	question: string;
	options: string[];
}
export interface CodexApproval {
	id: string;
	method: string;
	title: string;
	detail: string;
	questions: CodexQuestion[];
}
export interface CodexModel {
	id: string;
	name: string;
	efforts: string[];
	defaultEffort: string;
}
export interface CodexSessionState {
	key: string;
	threadId: string | null;
	cwd: string;
	title: string;
	model: string;
	effort: string;
	status: "loading" | "idle" | "working" | "error";
	turnId: string | null;
	items: CodexItem[];
	approvals: CodexApproval[];
	error: string | null;
	historyCursor: string | null;
	diff: string;
	contextTokens: number | null;
	contextWindow: number | null;
	turns?: CodexTurn[];
	workingSince?: number;
}
export type CodexPermission = "default" | "read-only" | "full-access";

export function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
export function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}
export function list(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

export function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

/** Keep image payloads out of JSON output. Only provider-supplied raster images render. */
function toolContent(value: unknown) {
	const images: string[] = [];
	const lines: string[] = [];
	if (typeof value === "string") return { body: value, images };
	for (const part of list(value)) {
		const p = record(part);
		const line = text(p.text);
		if (line) lines.push(line);
		const src =
			text(p.imageUrl) ||
			text(p.image_url) ||
			(p.type === "image" &&
			/^image\/(png|jpeg|webp|gif)$/.test(text(p.mimeType))
				? `data:${text(p.mimeType)};base64,${text(p.data)}`
				: "");
		if (/^(data:image\/(png|jpeg|webp|gif);base64,|https:\/\/)/i.test(src))
			images.push(src);
	}
	return { body: lines.join("\n\n"), images };
}

export function normalizeCodexItem(
	value: unknown,
	turnId: string,
): CodexItem | null {
	const item = record(value);
	const type = text(item.type);
	const id = text(item.id);
	if (!id || type === "hookPrompt") return null;
	const kind =
		type === "userMessage"
			? "user"
			: type === "agentMessage"
				? "assistant"
				: "activity";
	let body = text(item.text);
	const extra: Partial<CodexItem> = { activityType: type };
	const duration = finiteNumber(item.durationMs);
	if (duration !== undefined) extra.durationMs = duration;
	let title = type
		.replace(/([A-Z])/g, " $1")
		.replace(/^./, (c) => c.toUpperCase());
	if (kind === "user") {
		body = list(item.content)
			.map((part) => {
				const p = record(part);
				return (
					text(p.text) ||
					(p.type === "image" || p.type === "localImage"
						? "[Attached image]"
						: "")
				);
			})
			.filter(Boolean)
			.join("\n\n");
	}
	if (type === "reasoning") {
		title = "Reasoning summary";
		body = list(item.summary).map(text).join("\n");
	}
	if (type === "commandExecution") {
		title = text(item.command) || "Ran command";
		body = text(item.aggregatedOutput);
		extra.command = text(item.command);
		extra.cwd = text(item.cwd);
		extra.exitCode = finiteNumber(item.exitCode);
		const actions = list(item.commandActions).map(record);
		if (actions.length && actions.every((a) => a.type === "read")) {
			extra.activityType = "read";
			title = `Read ${
				actions
					.map((a) => text(a.name) || text(a.path))
					.filter(Boolean)
					.join(", ") || "files"
			}`;
		} else if (
			actions.length &&
			actions.every((a) => a.type === "search" || a.type === "listFiles")
		) {
			extra.activityType = "search";
			title = `Searched ${
				actions
					.map((a) => text(a.query) || text(a.path))
					.filter(Boolean)
					.join(", ") || "files"
			}`;
		}
	}
	if (type === "fileChange") {
		title = "Edited files";
		extra.changes = list(item.changes).map((v) => {
			const c = record(v);
			return {
				path: text(c.path),
				diff: text(c.diff),
				kind: text(record(c.kind).type),
			};
		});
		body = extra.changes.map((c) => `${c.path}\n${c.diff}`).join("\n\n");
	}
	if (type === "mcpToolCall") {
		title = `${text(item.server)} / ${text(item.tool)}`;
		extra.tool = text(item.tool);
		extra.input = JSON.stringify(item.arguments, null, 2);
		extra.url = text(record(item.arguments).url);
		const content = toolContent(record(item.result).content);
		extra.images = content.images;
		body =
			content.body || (item.error ? JSON.stringify(item.error, null, 2) : "");
		if (!body && record(item.result).structuredContent)
			body = JSON.stringify(record(item.result).structuredContent, null, 2);
		if (
			text(item.server) === "gatedspace_browser" ||
			/^browser_/.test(extra.tool)
		)
			extra.activityType = "browser";
	}
	if (type === "webSearch") {
		title = "Searched the web";
		const action = record(item.action);
		extra.url = text(action.url);
		body = [
			text(item.query) || text(action.query),
			...list(action.queries).map(text),
			text(action.url),
			text(action.pattern),
			...(item.results ? [JSON.stringify(item.results, null, 2)] : []),
		]
			.filter(Boolean)
			.join("\n\n");
	}
	if (type === "imageView") {
		title = "Viewed an image";
		body = text(item.path);
	}
	if (type === "contextCompaction") title = "Conversation compacted";
	if (type === "functionCallOutput") {
		title = text(item.name) || "Tool output";
		const content = toolContent(item.output);
		body = content.body;
		extra.images = content.images;
	}
	if (type === "dynamicToolCall") {
		title = text(item.tool) || "Tool call";
		extra.tool = text(item.tool);
		extra.input = JSON.stringify(item.arguments, null, 2);
		const content = toolContent(item.contentItems);
		body = content.body;
		extra.images = content.images;
	}
	return {
		...extra,
		id,
		turnId,
		kind,
		title,
		text: body,
		status: text(item.status),
		phase: text(item.phase),
	};
}
