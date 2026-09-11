/**
 * A tab that has not decided what it is yet.
 *
 * `+` used to open a dropdown, so making a tab meant choosing what it would be
 * BEFORE you had one — and changing your mind meant closing it and starting
 * again. Now `+` makes the tab immediately and the tab asks the question, which
 * is the same shape as a fresh workspace: an empty thing that offers you the
 * ways to fill it.
 *
 * FILLS ITSELF IN PLACE, and does it by reusing the existing openers rather
 * than by mutating its own pane. Each action runs the ordinary opener with
 * `target: "active-tab"` — which appends a pane to this tab — and then closes
 * the launcher. So the tab briefly holds two panes and settles on one, and none
 * of the launch logic (creating a pty and awaiting it, seeding session data,
 * resolving a preset's agent) is duplicated here.
 *
 * Order matters: launch first, close second. Closing first would leave the tab
 * with no panes, which removes the tab.
 */
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { cn } from "@superset/ui/utils";
import { BsTerminalPlus } from "react-icons/bs";
import {
	LuChevronDown,
	LuFolderPlus,
	LuHistory,
	LuLayoutPanelTop,
	LuSearch,
} from "react-icons/lu";
import { TbWorld } from "react-icons/tb";
import { usePresetIcon } from "renderer/assets/app-icons/preset-icons";
import type { V2TerminalPresetRow } from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal";
import { useOpenNewWorkspaceModal } from "renderer/stores/new-workspace-modal";

/**
 * Named "new tab" rather than "launcher": `launcher` already means the TERMINAL
 * launcher throughout this route, and two different things under one word in
 * the same file is how the wrong one gets wired.
 *
 * `onDone` is supplied by the registry from the pane's own context, so the
 * page hands over only the actions and never has to know which pane is asking.
 */
export interface NewTabPaneActions {
	agents: V2TerminalPresetRow[];
	/**
	 * Open an agent the way it opens by default: a session pane for Claude, a
	 * terminal for everything else.
	 */
	onLaunchAgent: (preset: V2TerminalPresetRow) => void;
	/**
	 * Open an agent in a specific shape. Only called for presets that
	 * `canOpenAsPane` says have both, which today means Claude.
	 */
	onLaunchAgentAs: (
		preset: V2TerminalPresetRow,
		mode: "pane" | "terminal",
	) => void;
	/**
	 * Whether this preset has a session pane as well as a terminal. Clicking it
	 * used to go straight to the pane with no way to ask for the terminal, and
	 * the terminal is what you want whenever you care about the raw output.
	 */
	canOpenAsPane: (preset: V2TerminalPresetRow) => boolean;
	onLaunchAll: () => void;
	onOpenTerminal: () => void;
	onOpenBrowser: () => void;
	onOpenQuickOpen: () => void;
	onOpenSessions: () => void;
}

const AGENT_BUTTON_CLASS =
	/*
	 * The properties are LISTED, not `transition-all`.
	 *
	 * `all` makes the browser watch every animatable property on the element, so a
	 * hover that changes a colour also arms transitions on width, height and
	 * everything else — which is how a row that only meant to lift a pixel ends up
	 * animating its own layout when something upstream reflows. Naming the four
	 * that actually change also keeps the lift on the compositor.
	 */
	"group flex h-12 w-full items-center gap-3 rounded-xl border border-border bg-[var(--gs-pane-surface,transparent)] px-3.5 text-[13.5px] text-foreground transition-[transform,box-shadow,background-color,border-color] duration-150 ease-out hover:-translate-y-px hover:border-highlight/60 hover:bg-accent/40 hover:shadow-[0_2px_10px_-4px_rgb(0_0_0/0.5)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function AgentFace({ preset }: { preset: V2TerminalPresetRow }) {
	const icon = usePresetIcon(preset.name);
	return (
		<>
			{icon ? (
				<img
					alt=""
					src={icon}
					className="size-[18px] shrink-0 object-contain"
				/>
			) : (
				<span className="size-[18px] shrink-0 rounded-[5px] bg-muted" />
			)}
			<span className="min-w-0 flex-1 truncate text-left">{preset.name}</span>
		</>
	);
}

function AgentButton({
	preset,
	onClick,
}: {
	preset: V2TerminalPresetRow;
	onClick: () => void;
}) {
	return (
		<button type="button" onClick={onClick} className={AGENT_BUTTON_CLASS}>
			<AgentFace preset={preset} />
		</button>
	);
}

/**
 * The same tile, but it asks which shape you want first.
 *
 * A pane and a terminal are genuinely different tools for the same agent — the
 * pane renders the stream as a transcript, the terminal shows the raw program —
 * and the tile cannot guess which one this particular launch is for. Two rows
 * beat a default plus a modifier key nobody discovers.
 */
function AgentChoiceButton({
	preset,
	onChoose,
}: {
	preset: V2TerminalPresetRow;
	onChoose: (mode: "pane" | "terminal") => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button type="button" className={AGENT_BUTTON_CLASS}>
					<AgentFace preset={preset} />
					{/* Says the tile asks a question, before you find out by clicking. */}
					<LuChevronDown className="size-3.5 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-56">
				<DropdownMenuItem onSelect={() => onChoose("pane")}>
					<LuLayoutPanelTop className="size-4 shrink-0 opacity-70" />
					<span className="flex-1">Session pane</span>
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => onChoose("terminal")}>
					<BsTerminalPlus className="size-4 shrink-0 opacity-70" />
					<span className="flex-1">Terminal</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function SecondaryRow({
	icon: Icon,
	label,
	hint,
	onClick,
}: {
	icon: typeof BsTerminalPlus;
	label: string;
	hint?: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex h-9 w-full items-center gap-2.5 rounded-[10px] border border-transparent px-2 text-[13px] text-muted-foreground transition-colors hover:border-border hover:bg-accent/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
		>
			<span className="flex size-6 shrink-0 items-center justify-center rounded-[7px] bg-muted/50 text-muted-foreground/80">
				<Icon className="size-3.5" />
			</span>
			<span className="min-w-0 flex-1 truncate text-left">{label}</span>
			{hint ? (
				<span className="shrink-0 font-mono text-[10px] text-muted-foreground/40">
					{hint}
				</span>
			) : null}
		</button>
	);
}

export function LauncherPane({
	agents,
	onLaunchAgent,
	onLaunchAgentAs,
	canOpenAsPane,
	onLaunchAll,
	onOpenTerminal,
	onOpenBrowser,
	onOpenQuickOpen,
	onOpenSessions,
	onDone,
}: NewTabPaneActions & { onDone: () => void }) {
	const openNewWorkspace = useOpenNewWorkspaceModal();

	// Every action is "do the thing, then stop being a launcher".
	const run = (action: () => void) => () => {
		action();
		onDone();
	};

	return (
		<div className="flex h-full w-full items-center justify-center overflow-auto p-6">
			<div className="flex w-full max-w-[480px] flex-col">
				{agents.length > 0 ? (
					<>
						<span className="mb-2.5 px-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground/40">
							Start an agent
						</span>
						<div
							className={cn(
								"grid gap-2",
								agents.length > 1 ? "grid-cols-2" : "grid-cols-1",
							)}
						>
							{agents.map((preset) =>
								canOpenAsPane(preset) ? (
									<AgentChoiceButton
										key={preset.id}
										preset={preset}
										onChoose={(mode) =>
											run(() => onLaunchAgentAs(preset, mode))()
										}
									/>
								) : (
									<AgentButton
										key={preset.id}
										preset={preset}
										onClick={run(() => onLaunchAgent(preset))}
									/>
								),
							)}
						</div>
					</>
				) : null}

				{agents.length > 1 ? (
					<button
						type="button"
						onClick={run(onLaunchAll)}
						className="mt-2 rounded-[10px] border border-highlight/25 py-2 text-[12.5px] text-highlight transition-colors hover:border-highlight/50 hover:bg-highlight/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
					>
						Launch all {agents.length} side by side
					</button>
				) : null}

				<span className="mt-5 mb-2.5 px-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground/40">
					Or open
				</span>
				{/*
				 * Two columns rather than a stack. The same rows in one narrow
				 * column read as a leftover menu under the tiles; paired up they
				 * read as the second half of a chooser, and the panel stops being
				 * taller than it is wide.
				 */}
				<div className="grid grid-cols-2 gap-x-3 gap-y-px">
					<SecondaryRow
						icon={BsTerminalPlus}
						label="Terminal"
						onClick={run(onOpenTerminal)}
					/>
					<SecondaryRow
						icon={TbWorld}
						label="Browser"
						onClick={run(onOpenBrowser)}
					/>
					<SecondaryRow
						icon={LuSearch}
						label="Search files"
						onClick={run(onOpenQuickOpen)}
					/>
					{/*
					 * Recent sessions lived ONLY in the dropdown the `+` button used to
					 * open, so it would have been the one thing lost by replacing that
					 * dropdown with this pane. It is also still a sidebar nav row.
					 */}
					<SecondaryRow
						icon={LuHistory}
						label="Recent sessions"
						onClick={run(onOpenSessions)}
					/>
					{/*
					 * Reached the modal from the sidebar only. Starting a new
					 * workspace is the other thing an empty tab is for, and it is
					 * a global store, so it needs nothing threaded through.
					 */}
					<SecondaryRow
						icon={LuFolderPlus}
						label="New workspace"
						onClick={run(openNewWorkspace)}
					/>
				</div>
			</div>
		</div>
	);
}
