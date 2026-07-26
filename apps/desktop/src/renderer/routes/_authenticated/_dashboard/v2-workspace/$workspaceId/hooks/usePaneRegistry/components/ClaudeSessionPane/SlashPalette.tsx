/**
 * The slash palette: what opens as soon as you type `/`.
 *
 * Two things it does that a plain autocomplete list doesn't:
 *
 *  - Some commands are ANSWERED HERE rather than sent. `/context`, `/model` and
 *    `/usage` are local — the CLI replies without a turn — so their output
 *    belongs in a panel, not as a wall of text in the conversation you were
 *    reading. Typing one shows the panel live, with no Enter.
 *  - Everything else stays a filter over the session's real slash commands and
 *    is sent as typed, so nothing the CLI supports is lost by being unlisted.
 *
 * The panel loads when the command is EXACTLY matched, not merely a prefix, so
 * typing `/c` doesn't fire `/context` on the way to `/clear`.
 */
import { cn } from "@superset/ui/utils";
import { Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
	type ContextReport,
	MODEL_CHOICES,
	type ModelReport,
	parseContextReport,
	parseModelReport,
} from "shared/claude-session/context-report";
import {
	parseUsageReport,
	type UsageReport,
} from "shared/claude-session/usage-report";

/** Commands this pane answers itself instead of sending to the conversation. */
export const PANEL_COMMANDS = ["context", "model", "usage"] as const;
export type PanelCommand = (typeof PANEL_COMMANDS)[number];

/**
 * Which panel the typed text calls for, if any.
 *
 * Exact match only: a prefix would fire `/context` while the user is still on
 * their way to `/clear`, and each fire runs a command in the live session.
 */
export function panelFor(text: string): PanelCommand | null {
	const trimmed = text.trim();
	// The slash is required, not optional: "context" is a word someone might be
	// typing into a prompt, and opening a panel over it would be wrong.
	if (!trimmed.startsWith("/")) return null;
	const word = trimmed.slice(1).toLowerCase();
	return (PANEL_COMMANDS as readonly string[]).includes(word)
		? (word as PanelCommand)
		: null;
}

/** A bar showing where the context window has gone, in category order. */
function ContextBar({ report }: { report: ContextReport }) {
	// Free space is the remainder, not a consumer — drawing it would make the bar
	// always full and say nothing.
	const used = report.categories.filter(
		(c) => !/free space/i.test(c.name) && c.percent > 0,
	);
	const colors = [
		"#d97757",
		"#3b82f6",
		"#22c55e",
		"#eab308",
		"#a855f7",
		"#ef4444",
		"#14b8a6",
	];
	return (
		<div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
			{used.map((category, index) => (
				<span
					key={category.name}
					style={{
						width: `${category.percent}%`,
						backgroundColor: colors[index % colors.length],
					}}
					title={`${category.name} · ${category.tokens}`}
				/>
			))}
		</div>
	);
}

function ContextPanel({ report }: { report: ContextReport }) {
	const colors = [
		"#d97757",
		"#3b82f6",
		"#22c55e",
		"#eab308",
		"#a855f7",
		"#ef4444",
		"#14b8a6",
	];
	let swatch = 0;
	return (
		<div className="flex flex-col gap-2.5 px-3 py-2.5">
			<div>
				<div className="text-[13px] text-foreground">Context usage</div>
				{report.model ? (
					<div className="font-mono text-[11.5px] text-muted-foreground">
						{report.model}
					</div>
				) : null}
				{report.usedTokens ? (
					<div className="text-[12.5px] text-muted-foreground">
						{report.usedTokens} / {report.totalTokens} tokens
						{report.usedPercent === null ? "" : ` (${report.usedPercent}%)`}
					</div>
				) : null}
			</div>
			<ContextBar report={report} />
			<div className="flex flex-col gap-0.5">
				{report.categories.map((category) => {
					const free = /free space/i.test(category.name);
					const color = free ? null : colors[swatch++ % colors.length];
					return (
						<div
							key={category.name}
							className="flex items-center gap-2 text-[12.5px]"
						>
							<span
								className="size-2.5 shrink-0 rounded-[2px]"
								style={{ backgroundColor: color ?? "transparent" }}
							/>
							<span
								className={cn(
									"min-w-0 flex-1 truncate",
									free ? "text-muted-foreground/70" : "text-foreground",
								)}
							>
								{category.name}
							</span>
							<span className="tabular-nums text-muted-foreground">
								{category.tokens}
							</span>
							<span className="w-12 text-right tabular-nums text-muted-foreground/70">
								{category.percent}%
							</span>
						</div>
					);
				})}
			</div>
			{report.memoryFiles.length > 0 ? (
				<div>
					<div className="pb-0.5 text-[11px] uppercase tracking-wide text-muted-foreground/60">
						Memory files
					</div>
					{report.memoryFiles.map((file) => (
						<div
							key={file.name}
							className="flex items-center gap-2 text-[12px]"
						>
							<span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
								{file.name}
							</span>
							<span className="tabular-nums text-muted-foreground/70">
								{file.tokens}
							</span>
						</div>
					))}
				</div>
			) : null}
		</div>
	);
}

function ModelPanel({
	report,
	onPick,
}: {
	report: ModelReport | null;
	onPick: (id: string) => void;
}) {
	// Offer the CLI's own list when it gave one, so a model added upstream shows
	// up without a release here; fall back to the curated set for descriptions.
	const known = new Set(report?.available ?? []);
	const choices = MODEL_CHOICES.filter(
		(choice) => known.size === 0 || known.has(choice.id),
	);
	const extra = (report?.available ?? []).filter(
		(id) => !MODEL_CHOICES.some((choice) => choice.id === id),
	);
	const current = report?.current?.toLowerCase() ?? "";

	return (
		<div className="flex flex-col px-1 py-1">
			<div className="px-2 py-1 text-[12.5px] text-muted-foreground">
				Select a model
			</div>
			{choices.map((choice) => {
				const selected = current.startsWith(choice.label.toLowerCase());
				return (
					<button
						key={choice.id}
						type="button"
						onMouseDown={(e) => {
							e.preventDefault();
							onPick(choice.id);
						}}
						className={cn(
							"flex items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
							selected ? "bg-accent" : "hover:bg-accent/50",
						)}
					>
						<span className="min-w-0 flex-1">
							<span className="block text-[13px] text-foreground">
								{choice.label}
							</span>
							<span className="block text-[12px] text-muted-foreground/80">
								{choice.description}
							</span>
						</span>
						{selected ? (
							<Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
						) : null}
					</button>
				);
			})}
			{extra.length > 0 ? (
				<div className="px-2 pt-1 pb-0.5 font-mono text-[11px] text-muted-foreground/60">
					also accepts: {extra.join(", ")}
				</div>
			) : null}
		</div>
	);
}

function UsagePanel({ report }: { report: UsageReport }) {
	const bar = (label: string, percent: number, resets: string) => (
		<div className="flex flex-col gap-1">
			<div className="flex items-baseline justify-between text-[12.5px]">
				<span className="text-foreground">{label}</span>
				<span className="tabular-nums text-muted-foreground">{percent}%</span>
			</div>
			<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
				<span
					className="block h-full rounded-full"
					style={{
						width: `${Math.min(percent, 100)}%`,
						backgroundColor:
							percent >= 90 ? "#ef4444" : percent >= 70 ? "#eab308" : "#d97757",
					}}
				/>
			</div>
			<div className="text-[11.5px] text-muted-foreground/70">
				Resets {resets}
			</div>
		</div>
	);

	return (
		<div className="flex flex-col gap-3 px-3 py-2.5">
			{report.headline ? (
				<div className="text-[12.5px] text-muted-foreground">
					{report.headline}
				</div>
			) : null}
			{report.session
				? bar(
						"Session (5hr)",
						report.session.usedPercent,
						report.session.resetsAt,
					)
				: null}
			{report.week
				? bar("Weekly (7 day)", report.week.usedPercent, report.week.resetsAt)
				: null}
			{report.activity.map((block) => (
				<div key={block.label} className="flex flex-col gap-0.5">
					<div className="text-[11px] uppercase tracking-wide text-muted-foreground/60">
						{block.label} · {block.requests.toLocaleString()} requests ·{" "}
						{block.sessions} sessions
					</div>
					{block.facts.map((fact) => (
						<div key={fact} className="text-[12px] text-muted-foreground">
							{fact}
						</div>
					))}
				</div>
			))}
		</div>
	);
}

export function SlashPalette({
	text,
	commands,
	onPickCommand,
	onRunCommand,
	onPickModel,
}: {
	/** What's in the composer right now, starting with "/". */
	text: string;
	/** Slash commands the session reported at init. */
	commands: string[];
	onPickCommand: (command: string) => void;
	/** Run a local command in the live session and hand back its raw reply. */
	onRunCommand: (command: string) => Promise<string | null>;
	onPickModel: (id: string) => void;
}) {
	const panel = panelFor(text);
	const [raw, setRaw] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	// Ask the session as soon as the command is complete. The guard drops a
	// reply that lands after the user has typed on, which would otherwise render
	// a panel for a command they've already left.
	useEffect(() => {
		if (!panel) {
			setRaw(null);
			return;
		}
		let current = true;
		setLoading(true);
		setRaw(null);
		void onRunCommand(`/${panel}`)
			.then((reply) => {
				if (!current) return;
				setRaw(reply);
			})
			.finally(() => {
				if (current) setLoading(false);
			});
		return () => {
			current = false;
		};
	}, [panel, onRunCommand]);

	const query = text.slice(1).toLowerCase();
	const matches = commands
		.filter((c) => c.toLowerCase().startsWith(query))
		.slice(0, 8);

	if (!panel && matches.length === 0) return null;

	return (
		<div className="absolute bottom-full left-0 z-40 mb-1 max-h-[26rem] w-full overflow-y-auto rounded-lg border border-border bg-popover shadow-md">
			{matches.length > 0 ? (
				<div className="flex flex-col py-1">
					<div className="px-2.5 py-1 text-[11px] uppercase tracking-wide text-muted-foreground/60">
						Slash commands
					</div>
					{matches.map((command) => (
						<button
							key={command}
							type="button"
							onMouseDown={(e) => {
								e.preventDefault();
								onPickCommand(command);
							}}
							className={cn(
								"px-2.5 py-1 text-left font-mono text-xs transition-colors hover:bg-accent",
								`/${command}` === text.trim()
									? "bg-accent text-foreground"
									: "text-muted-foreground",
							)}
						>
							/{command}
						</button>
					))}
				</div>
			) : null}

			{panel ? (
				<div className="border-border/60 border-t">
					{loading ? (
						<div className="flex items-center gap-2 px-3 py-3 text-[12.5px] text-muted-foreground">
							<Loader2 className="size-3.5 animate-spin" />
							{panel === "usage"
								? "Asking your account…"
								: "Asking the session…"}
						</div>
					) : raw === null ? (
						<div className="px-3 py-3 text-[12.5px] text-muted-foreground">
							{/*
							 * Two different failures, and telling them apart matters.
							 *
							 * /context and /model ask the LIVE session, which won't answer
							 * mid-turn: capturing a reply then would divert the turn's own.
							 *
							 * /usage never touches the session — it asks the account through
							 * a throwaway process. Telling the user to wait for the turn to
							 * finish was advice for a mechanism this command doesn't use,
							 * which is worse than saying nothing: it sent them to watch the
							 * wrong thing while the real fault sat elsewhere.
							 */}
							{panel === "usage"
								? "Couldn't read your account's usage. The claude CLI didn't answer — check it's signed in for this account."
								: `/${panel} needs the session between turns. Try again once this one finishes, or press Enter to run it in the conversation.`}
						</div>
					) : panel === "context" ? (
						<ContextPanel report={parseContextReport(raw)} />
					) : panel === "model" ? (
						<ModelPanel report={parseModelReport(raw)} onPick={onPickModel} />
					) : (
						<UsagePanel report={parseUsageReport(raw)} />
					)}
				</div>
			) : null}
		</div>
	);
}
