/**
 * Presentational renderer for a Claude Code session timeline.
 *
 * Pure: driven entirely by a `SessionTimeline` (see shared/claude-session/
 * timeline.ts), so it renders identically from a live stream or a captured
 * transcript.
 *
 * The layout tracks the VS Code Claude Code extension on purpose — that's the
 * reading experience being asked for here. The choices that carry weight:
 *
 *   - FULL WIDTH. A centered max-width column starves the two things that need
 *     horizontal room most: a side-by-side diff and an unwrapped shell command.
 *   - STANDALONE DOTS, no connecting rail. A rail implies the steps nest inside
 *     something; they don't. Each dot is a status light, nothing more.
 *   - The prompt is a full-width panel, so a turn boundary is unmistakable when
 *     scrolling fast. A quote bar read as emphasis instead of structure.
 *   - A tool call is a HEADER LINE, not a card: bold name plus the single
 *     argument that says what the call was about. Only tools with something
 *     worth showing get a body at all.
 *   - Shell commands show IN and OUT. Output divorced from the command that
 *     produced it is unreadable one screen later.
 *   - Edits render as a diff headed by "Added N lines" — the shape of the change
 *     is the summary.
 *   - Read renders nothing below its header. The path is the whole story, and a
 *     file dump per read buries the conversation.
 */
import { cn } from "@superset/ui/utils";
import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MarkdownRenderer } from "renderer/components/MarkdownRenderer";
import {
	groupSubagents,
	type SessionTimeline,
	type ThinkingItem,
	type TimelineItem,
	type ToolItem,
	type UserTextItem,
} from "shared/claude-session/timeline";
import { ImageChip } from "./ImageChip";
import { DIFF_MAX_CHARS, SessionDiff } from "./SessionDiff";
import { WorkingIndicator } from "./WorkingIndicator";
import { formatThought } from "./working-indicator";

/**
 * Every tool body collapses to the same ten lines.
 *
 * Uniform on purpose: when each kind of body picked its own height, a run of
 * calls became a ragged column and the eye had to re-find the left edge on every
 * one. Ten is about what you can read without deciding to read it.
 *
 * Heights are derived from the line-height each body actually renders at, so
 * "ten lines" stays ten lines rather than drifting when a font size changes.
 */
const MAX_BODY_LINES = 10;
/** 11.5px mono at leading-relaxed. */
const MONO_LINE_HEIGHT = 19;
/** Set on the diff viewer as --diffs-line-height. */
const DIFF_LINE_HEIGHT = 17;

const OUTPUT_MAX_HEIGHT = MAX_BODY_LINES * MONO_LINE_HEIGHT;
const DIFF_MAX_HEIGHT = MAX_BODY_LINES * DIFF_LINE_HEIGHT;

/**
 * The pinned prompt gets far less, because it's pinned. A ten-line question
 * stuck to the top of the screen is a ten-line hole in the answer you're
 * reading, which is the opposite of what pinning it was for.
 */
const PROMPT_MAX_LINES = 2;
const PROMPT_LINE_HEIGHT = 20;
/**
 * The fade has to be shorter than the clamp, or it washes out text that is
 * still meant to be readable. At two lines a 32px fade covered most of the
 * second one, which made the pinned prompt look broken rather than truncated.
 */
const PROMPT_FADE_HEIGHT = 16;

/** Shells get the IN/OUT treatment: their input is as interesting as their output. */
const SHELL_TOOLS = new Set(["Bash", "PowerShell", "BashOutput", "KillShell"]);
/** These change a file, so the change itself is the right summary. */
const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
/** Their header already says everything; a body would only be noise. */
const HEADER_ONLY_TOOLS = new Set(["Read", "TodoWrite"]);
/** Searches: how many hits is the answer, the hits themselves rarely are. */
const SEARCH_TOOLS = new Set(["Glob", "Grep"]);

type DotState = "prose" | "running" | "success" | "error";

/**
 * Smoothly animate an auto-height region open/closed via the grid-rows
 * 0fr↔1fr trick (transitions height that `height:auto` can't).
 */
function Collapse({
	open,
	children,
}: {
	open: boolean;
	children: React.ReactNode;
}) {
	return (
		<div
			className={cn(
				"grid transition-[grid-template-rows] duration-200 ease-out",
				open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
			)}
		>
			<div className="overflow-hidden">{children}</div>
		</div>
	);
}

/**
 * One step in a turn: a status dot in the left gutter, content to its right.
 * The dot is deliberately unconnected — see the file header.
 */
function Row({
	state,
	children,
}: {
	state: DotState;
	children: React.ReactNode;
}) {
	return (
		<div className="relative pl-8">
			<span
				className={cn(
					"absolute top-[7px] left-2 size-[7px] shrink-0 rounded-full",
					state === "success" && "bg-success",
					state === "error" && "bg-destructive",
					state === "running" && "animate-pulse bg-warning",
					state === "prose" && "bg-muted-foreground/40",
				)}
			/>
			<div className="min-w-0">{children}</div>
		</div>
	);
}

function ThinkingBlock({
	item,
	streaming,
}: {
	item: ThinkingItem;
	streaming: boolean;
}) {
	const [open, setOpen] = useState(false);
	const startedAt = useRef(Date.now());
	const [tookMs, setTookMs] = useState<number | null>(null);

	// Freeze the duration the moment it stops streaming. The fold can't carry
	// this — it's a pure function of the event list and has no clock — so the
	// renderer times what it watched, then keeps the number.
	useEffect(() => {
		if (streaming || tookMs !== null) return;
		setTookMs(Date.now() - startedAt.current);
	}, [streaming, tookMs]);

	return (
		<Row state="prose">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="-ml-4 flex items-center gap-1 text-[13px] text-muted-foreground/80 transition-colors hover:text-foreground focus-visible:outline-none"
			>
				<ChevronRight
					className={cn(
						"size-3 transition-transform duration-200",
						open && "rotate-90",
					)}
				/>
				{streaming ? (
					<WorkingIndicator startedAt={startedAt.current} phrase={false} />
				) : (
					// Past tense with a duration, so a long pause is explained after the
					// fact instead of just having felt long.
					<span>
						Thought{tookMs === null ? "" : ` for ${formatThought(tookMs)}`}
					</span>
				)}
			</button>
			<Collapse open={open}>
				<div className="whitespace-pre-wrap pt-1 text-xs text-muted-foreground/80 italic">
					{item.text}
				</div>
			</Collapse>
		</Row>
	);
}

/** A string field off a tool's input, or undefined when it's absent or blank. */
function str(input: Record<string, unknown>, key: string): string | undefined {
	const value = input[key];
	return typeof value === "string" && value.trim() ? value : undefined;
}

interface ToolArgument {
	/** Shown dim ahead of the value, e.g. `pattern:` — the CLI's own param name. */
	label?: string;
	value: string;
	/** Paths, patterns and commands are monospaced; prose descriptions aren't. */
	mono: boolean;
}

/**
 * The one argument that says what a call was about.
 *
 * Which field that is depends on the tool, so this dispatches rather than
 * scanning a priority list: a search's pattern wants its param name shown (the
 * extension prints `pattern: "…"`), a shell's `description` is prose and reads
 * wrong in monospace, and Task has neither a path nor a command — without its
 * description the row says only "Task", which is the least useful thing on
 * screen at the moment it matters most.
 */
export function toolArgument(item: ToolItem): ToolArgument | null {
	const input = item.input;

	if (SEARCH_TOOLS.has(item.name)) {
		const pattern = str(input, "pattern");
		if (pattern)
			return { label: "pattern:", value: `"${pattern}"`, mono: true };
	}

	if (SHELL_TOOLS.has(item.name) || item.name === "Task") {
		const description = str(input, "description");
		if (description) return { value: description, mono: false };
	}

	const path = str(input, "file_path") ?? str(input, "path");
	if (path) return { value: path, mono: true };

	const mono =
		str(input, "command") ?? str(input, "url") ?? str(input, "pattern");
	if (mono) return { value: mono, mono: true };

	const prose = str(input, "description") ?? str(input, "query");
	if (prose) return { value: prose, mono: false };

	return null;
}

function countLines(text: string): number {
	if (!text) return 0;
	return text.split("\n").length;
}

/** The old/new pairs an edit tool is about to apply, in order. */
export function editPairs(
	item: ToolItem,
): { oldString: string; newString: string }[] {
	const input = item.input;

	// MultiEdit carries a list; each entry has the same shape as a single Edit.
	const edits = input.edits;
	if (Array.isArray(edits)) {
		return edits.flatMap((edit) => {
			if (!edit || typeof edit !== "object") return [];
			const record = edit as Record<string, unknown>;
			const oldString =
				typeof record.old_string === "string" ? record.old_string : "";
			const newString =
				typeof record.new_string === "string" ? record.new_string : "";
			if (!oldString && !newString) return [];
			return [{ oldString, newString }];
		});
	}

	const oldString =
		typeof input.old_string === "string" ? input.old_string : "";
	const newString =
		typeof input.new_string === "string" ? input.new_string : "";
	if (oldString || newString) return [{ oldString, newString }];

	// Write (and NotebookEdit) replace the file outright: everything is new.
	const content =
		typeof input.content === "string"
			? input.content
			: typeof input.new_source === "string"
				? input.new_source
				: "";
	if (content) return [{ oldString: "", newString: content }];

	return [];
}

/**
 * "Added 8 lines" / "Removed 3 lines" / "Edited" — the net line delta, which is
 * what the extension shows and the only number worth a whole line here.
 */
export function editSummary(item: ToolItem): string | null {
	const pairs = editPairs(item);
	if (pairs.length === 0) return null;
	let delta = 0;
	for (const pair of pairs) {
		delta += countLines(pair.newString) - countLines(pair.oldString);
	}
	if (delta > 0) return `Added ${delta} line${delta === 1 ? "" : "s"}`;
	if (delta < 0) {
		const removed = -delta;
		return `Removed ${removed} line${removed === 1 ? "" : "s"}`;
	}
	return "Edited";
}

/**
 * "Found 3 files" for a search. Derived from the output rather than reported by
 * the tool, so it stays honest when a search returns nothing.
 */
export function searchSummary(item: ToolItem): string | null {
	if (item.status === "running") return null;
	const output = item.output?.trim();
	if (!output) return "No matches";
	const hits = output.split("\n").filter((line) => line.trim()).length;
	if (item.name === "Glob") return `Found ${hits} file${hits === 1 ? "" : "s"}`;
	return `Found ${hits} match${hits === 1 ? "" : "es"}`;
}

/** A dim line under a tool header: the summary that stands in for a body. */
function ToolNote({ children }: { children: React.ReactNode }) {
	return (
		<div className="pt-0.5 text-[12.5px] text-muted-foreground/75">
			{children}
		</div>
	);
}

/**
 * Text clamped to a few lines until asked otherwise. Overflow is measured rather
 * than counted, because one very long wrapped line overflows just as easily as
 * forty short ones.
 */
function Clamped({
	children,
	maxHeight,
	lines,
	fade,
}: {
	children: React.ReactNode;
	maxHeight: number;
	/** Shown on the toggle so expanding isn't a blind click. */
	lines?: number;
	/**
	 * Gradient `from-` class matching the surface behind the clipped content. Left
	 * off where the surface is theme-supplied (a diff paints its own background),
	 * because a fade to the wrong colour reads as a rendering bug.
	 */
	fade?: string;
}) {
	const [expanded, setExpanded] = useState(false);
	const [overflowing, setOverflowing] = useState(false);
	const boxRef = useRef<HTMLDivElement>(null);

	// No dependency list: content grows as a tool streams, and the measurement is
	// cheap and idempotent. Once expanded we stop measuring, so the toggle keeps
	// showing "Show less" instead of vanishing at full height.
	useEffect(() => {
		const el = boxRef.current;
		if (!el || expanded) return;
		setOverflowing(el.scrollHeight > el.clientHeight + 1);
	});

	return (
		<>
			<div className="relative">
				<div
					ref={boxRef}
					className={cn(!expanded && "overflow-hidden")}
					style={expanded ? undefined : { maxHeight }}
				>
					{children}
				</div>
				{!expanded && overflowing && fade ? (
					<div
						className={cn(
							"pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t to-transparent",
							fade,
						)}
					/>
				) : null}
			</div>
			{overflowing ? (
				<button
					type="button"
					onClick={() => setExpanded((v) => !v)}
					className="flex w-full items-center justify-between border-border/60 border-t px-3 py-1 text-[11px] text-muted-foreground/85 transition-colors hover:text-foreground focus-visible:outline-none"
				>
					<span>{expanded ? "Show less" : "Show more"}</span>
					{lines ? (
						<span className="tabular-nums">
							{lines} line{lines === 1 ? "" : "s"}
						</span>
					) : null}
				</button>
			) : null}
		</>
	);
}

/** A bordered panel below a tool header — the frame every tool body shares. */
function ToolPanel({ children }: { children: React.ReactNode }) {
	return (
		// No fill, only a border — sampled off the reference, where an IN/OUT panel
		// sits directly on the page. A tinted panel turned every shell call into a
		// heavy block and made a run of them read as stripes.
		<div className="mt-1.5 overflow-hidden rounded-lg border border-border/70">
			{children}
		</div>
	);
}

/**
 * One labelled stream inside a shell panel. The label sits in its own narrow
 * column so the command and its output line up under each other, which is what
 * makes a long command scannable next to the output it produced.
 *
 * Content doesn't wrap — it scrolls. A wrapped shell command loses the shape
 * that makes it readable.
 */
function StreamRow({
	label,
	text,
	clamp,
}: {
	label: string;
	text: string;
	clamp?: number;
}) {
	const body = (
		<pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre px-3 py-2 font-mono text-[11.5px] leading-relaxed text-muted-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
			{text}
		</pre>
	);
	return (
		<div className="flex">
			<span className="w-9 shrink-0 select-none py-2 pl-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/45">
				{label}
			</span>
			{clamp ? (
				<div className="min-w-0 flex-1">
					<Clamped
						maxHeight={clamp}
						lines={countLines(text)}
						fade="from-background"
					>
						{body}
					</Clamped>
				</div>
			) : (
				body
			)}
		</div>
	);
}

function ShellPanel({ item }: { item: ToolItem }) {
	const command = str(item.input, "command");
	const output = item.output?.replace(/\s+$/, "");
	if (!command && !output) return null;
	return (
		<ToolPanel>
			{command ? (
				<StreamRow label="in" text={command} clamp={OUTPUT_MAX_HEIGHT} />
			) : null}
			{command && output ? (
				<div className="mx-3 border-border/50 border-t" />
			) : null}
			{output ? (
				<StreamRow label="out" text={output} clamp={OUTPUT_MAX_HEIGHT} />
			) : null}
		</ToolPanel>
	);
}

function DiffPanel({ item }: { item: ToolItem }) {
	const path =
		str(item.input, "file_path") ?? str(item.input, "path") ?? "file";
	const pairs = editPairs(item);
	const tooBig = pairs.some(
		(pair) => pair.oldString.length + pair.newString.length > DIFF_MAX_CHARS,
	);
	if (pairs.length === 0 || tooBig) return null;
	return (
		<ToolPanel>
			<Clamped maxHeight={DIFF_MAX_HEIGHT}>
				<div className="flex flex-col">
					{pairs.map((pair, index) => (
						<SessionDiff
							// Edits within one call have no id of their own; position is
							// stable because the input never changes once the call exists.
							key={`${item.toolUseId}-${index}`}
							filePath={path}
							oldString={pair.oldString}
							newString={pair.newString}
						/>
					))}
				</div>
			</Clamped>
		</ToolPanel>
	);
}

function OutputPanel({ text }: { text: string }) {
	return (
		<ToolPanel>
			<Clamped
				maxHeight={OUTPUT_MAX_HEIGHT}
				lines={countLines(text)}
				fade="from-background"
			>
				<pre className="overflow-x-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11.5px] leading-relaxed text-muted-foreground">
					{text}
				</pre>
			</Clamped>
		</ToolPanel>
	);
}

/**
 * A tool call: header line, then whatever body that tool earns.
 *
 * Errors always show their output regardless of the tool's usual treatment — a
 * failed Read that says nothing is the worst row on the screen.
 */
function ToolCall({
	item,
	children,
}: {
	item: ToolItem;
	children?: React.ReactNode;
}) {
	const argument = toolArgument(item);
	const output = item.output?.replace(/\s+$/, "") ?? "";
	const failed = item.status === "error";

	let body: React.ReactNode = null;
	if (failed && output) {
		body = <OutputPanel text={output} />;
	} else if (SHELL_TOOLS.has(item.name)) {
		body = <ShellPanel item={item} />;
	} else if (EDIT_TOOLS.has(item.name)) {
		const summary = editSummary(item);
		body = (
			<>
				{summary ? <ToolNote>{summary}</ToolNote> : null}
				<DiffPanel item={item} />
			</>
		);
	} else if (SEARCH_TOOLS.has(item.name)) {
		const summary = searchSummary(item);
		body = summary ? <ToolNote>{summary}</ToolNote> : null;
	} else if (HEADER_ONLY_TOOLS.has(item.name)) {
		body = null;
	} else if (output) {
		body = <OutputPanel text={output} />;
	}

	return (
		<Row state={item.status === "running" ? "running" : item.status}>
			{/*
			 * No per-tool spinner. `Row` already pulses its dot while a tool runs
			 * and turns it green when it finishes, and the working line above is
			 * animating for the whole turn — a third moving thing on the same row
			 * just made the pane look busy rather than informative. The dot carries
			 * the state; the name and its output carry the content.
			 */}
			<div className="flex min-w-0 items-baseline gap-2">
				<span className="shrink-0 font-semibold text-[13.5px] text-foreground">
					{item.name}
				</span>
				{argument ? (
					<span className="min-w-0 truncate">
						{argument.label ? (
							<span className="font-mono text-[12px] text-muted-foreground/60">
								{argument.label}{" "}
							</span>
						) : null}
						<span
							className={cn(
								"text-muted-foreground",
								argument.mono ? "font-mono text-[12px]" : "text-[13px]",
							)}
						>
							{argument.value}
						</span>
					</span>
				) : null}
			</div>
			{body}
			{children}
		</Row>
	);
}

/** Blinking block cursor trailing live text, so you can see it being written. */
function StreamingCaret() {
	return (
		<span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-[1px] animate-pulse rounded-[1px] bg-foreground/70 align-baseline" />
	);
}

function SubagentGroup({
	items,
	drafts,
	label,
}: {
	items: TimelineItem[];
	drafts: ReadonlySet<string> | undefined;
	/** The subagent type that ran, when the Task call named one. */
	label?: string;
}) {
	const [open, setOpen] = useState(false);
	const steps = items.length;
	return (
		<div className="mt-1.5 overflow-hidden rounded-lg border border-border/60 bg-card/30">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none"
			>
				<ChevronRight
					className={cn(
						"size-3 transition-transform duration-200",
						open && "rotate-90",
					)}
				/>
				{label ?? "Subagent"} · {steps} step{steps === 1 ? "" : "s"}
			</button>
			<Collapse open={open}>
				<div className="flex flex-col gap-3 border-border/60 border-t py-2.5">
					{items.map((child) => (
						<TimelineItemRow
							key={child.id}
							item={child}
							groups={undefined}
							drafts={drafts}
						/>
					))}
				</div>
			</Collapse>
		</div>
	);
}

function TimelineItemRow({
	item,
	groups,
	drafts,
}: {
	item: TimelineItem;
	groups: Map<string, TimelineItem[]> | undefined;
	drafts: ReadonlySet<string> | undefined;
}) {
	const streaming = drafts?.has(item.id) ?? false;
	switch (item.kind) {
		case "user":
			// Prompts are rendered by the turn wrapper, which frames the turn.
			return null;
		case "text":
			return (
				<Row state="prose">
					<div className="text-[13.5px] text-foreground">
						{/*
						 * MarkdownRenderer is built for full-page documents: its article
						 * carries px-8 py-6 and the wrapper is a full-height scroller.
						 * Inline in a timeline row that reads as prose indented away from
						 * the tool names, floating in vertical space, inside a nested
						 * scroll container. Undo all three here rather than changing a
						 * component the document views depend on.
						 */}
						<MarkdownRenderer
							content={item.text}
							// A session carries plenty of text that isn't authored markdown
							// — /usage output, listings, anything a slash command prints.
							// Those arrive with real newlines, and the standard markdown
							// rule turns them into one run-on paragraph.
							breaks
							// overflow-y-visible, not overflow-visible: tailwind-merge treats
							// those as different groups, so only the matching one overrides
							// the component's own overflow-y-auto.
							className="h-auto overflow-y-visible [&_article]:max-w-none [&_article]:p-0 [&_article>*:first-child]:mt-0 [&_article>*:last-child]:mb-0"
						/>
						{streaming ? <StreamingCaret /> : null}
					</div>
				</Row>
			);
		case "thinking":
			return <ThinkingBlock item={item} streaming={streaming} />;
		case "tool": {
			const children = groups?.get(item.toolUseId);
			return (
				<ToolCall item={item}>
					{children ? <SubagentGroup items={children} drafts={drafts} /> : null}
				</ToolCall>
			);
		}
		case "notice":
			return (
				<Row state={item.fatal ? "error" : "prose"}>
					<div
						className={cn(
							"whitespace-pre-wrap break-words rounded-md border px-2.5 py-1.5 text-xs",
							item.fatal
								? "border-destructive/40 bg-destructive/5 text-foreground"
								: "border-warning/40 bg-warning/5 text-muted-foreground",
						)}
					>
						{item.text}
					</div>
				</Row>
			);
		case "result":
			return (
				<Row state={item.isError ? "error" : "success"}>
					<div className="text-xs text-muted-foreground/70">
						{item.isError ? "Failed" : "Done"} · {item.numTurns} turn
						{item.numTurns === 1 ? "" : "s"} · ${item.costUsd.toFixed(4)} ·{" "}
						{(item.durationMs / 1000).toFixed(1)}s
					</div>
				</Row>
			);
		default:
			return null;
	}
}

/**
 * The turn's prompt, pinned and clamped.
 *
 * Click to open it; click again to put it back. Measured rather than counted,
 * because one long wrapped line fills three rows just as well as three short
 * ones, and a "show more" that appears on a two-word prompt looks broken.
 */
function PinnedPrompt({ prompt }: { prompt: UserTextItem }) {
	const [expanded, setExpanded] = useState(false);
	const [overflowing, setOverflowing] = useState(false);
	const textRef = useRef<HTMLDivElement>(null);

	// No dependency list: cheap, idempotent, and the text can arrive late on a
	// replayed transcript. Measuring stops once expanded so the control doesn't
	// vanish at full height.
	useEffect(() => {
		const el = textRef.current;
		if (!el || expanded) return;
		setOverflowing(el.scrollHeight > el.clientHeight + 1);
	});

	const clamped = !expanded && overflowing;

	return (
		<div className="sticky top-0 z-10 rounded-lg bg-card px-4 py-2.5 text-[13.5px] text-foreground shadow-sm">
			{prompt.attachments?.length ? (
				<div className="mb-1.5 flex flex-wrap items-start gap-1.5">
					{prompt.attachments.map((attachment, index) => (
						<ImageChip
							key={`${attachment.name}-${index}`}
							attachment={attachment}
						/>
					))}
				</div>
			) : null}
			{prompt.text ? (
				<button
					type="button"
					onClick={() => overflowing && setExpanded((v) => !v)}
					className={cn(
						"block w-full text-left focus-visible:outline-none",
						overflowing ? "cursor-pointer" : "cursor-default",
					)}
					aria-expanded={overflowing ? expanded : undefined}
				>
					<div className="relative">
						<div
							ref={textRef}
							className={cn(
								"whitespace-pre-wrap break-words",
								clamped && "overflow-hidden",
							)}
							style={
								clamped
									? { maxHeight: PROMPT_MAX_LINES * PROMPT_LINE_HEIGHT }
									: undefined
							}
						>
							{prompt.text}
						</div>
						{clamped ? (
							<div
								className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-card to-transparent"
								style={{ height: PROMPT_FADE_HEIGHT }}
							/>
						) : null}
					</div>
					{overflowing ? (
						<span className="mt-0.5 block text-[11px] text-muted-foreground/70">
							{expanded ? "Show less" : "Show more"}
						</span>
					) : null}
				</button>
			) : null}
		</div>
	);
}

interface Turn {
	id: string;
	prompt?: UserTextItem;
	items: TimelineItem[];
}

/**
 * Group the flat item list into turns, each starting at a user prompt. Work
 * that arrives before any prompt (a resumed transcript can start mid-stream)
 * forms a leading turn with no prompt of its own.
 */
function splitTurns(items: TimelineItem[]): Turn[] {
	const turns: Turn[] = [];
	let current: Turn = { id: "turn-0", items: [] };
	for (const item of items) {
		if (item.kind === "user") {
			if (current.prompt || current.items.length > 0) turns.push(current);
			current = { id: item.id, prompt: item, items: [] };
			continue;
		}
		current.items.push(item);
	}
	if (current.prompt || current.items.length > 0) turns.push(current);
	return turns;
}

export function SessionTimelineView({
	timeline,
}: {
	timeline: SessionTimeline;
}) {
	const { topLevel, groups } = groupSubagents(timeline.items);
	const drafts = new Set(timeline.drafts.map((d) => d.id));
	const turns = splitTurns(topLevel);

	// The counter measures the whole turn, not the current gap in it. Held in a
	// ref and stamped on the idle→streaming edge, so it survives the working line
	// disappearing and coming back while text streams in between tool calls.
	const turnStartRef = useRef(Date.now());
	const wasStreamingRef = useRef(false);
	const streaming = timeline.status === "streaming";
	if (streaming && !wasStreamingRef.current) turnStartRef.current = Date.now();
	wasStreamingRef.current = streaming;
	const turnStartedAt = turnStartRef.current;

	return (
		<div className="flex w-full flex-col px-4 py-4">
			{turns.map((turn, index) => (
				<div key={turn.id} className={cn(index > 0 && "mt-6")}>
					{turn.prompt ? (
						/*
						 * Sticky, so the prompt you're reading the answer to stays in view.
						 * Each turn being its own container is what makes plain CSS do the
						 * right thing: turn N's prompt pins while you're inside turn N,
						 * then the previous one takes over as you scroll back.
						 */
						<PinnedPrompt prompt={turn.prompt} />
					) : null}
					{turn.items.length > 0 ? (
						<div className="mt-3 flex flex-col gap-3">
							{turn.items.map((item) => (
								<TimelineItemRow
									key={item.id}
									item={item}
									groups={groups}
									drafts={drafts}
								/>
							))}
						</div>
					) : null}
				</div>
			))}
			{/*
			 * The working line trails the conversation for the WHOLE time a turn is
			 * running, including while text is streaming.
			 *
			 * It used to hide itself whenever a draft was arriving, on the theory
			 * that streaming text is its own motion and two indicators read as two
			 * things. In use that was worse: the line vanished and reappeared
			 * several times per turn, and because the elapsed counter only shows
			 * while the line does, the number appeared to jump around at random.
			 * One indicator that stays put for the whole turn answers "is it still
			 * going, and for how long" continuously, which is the only question
			 * being asked.
			 */}
			{timeline.status === "streaming" ? (
				<div className={cn(turns.length > 0 && "mt-3")}>
					<WorkingIndicator startedAt={turnStartedAt} className="pl-8" />
				</div>
			) : null}
		</div>
	);
}
