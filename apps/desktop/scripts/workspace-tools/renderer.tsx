import "../../src/renderer/globals.css";
import { useDndMonitor } from "@dnd-kit/core";
import {
	createWorkspaceStore,
	type PaneRegistry,
	type RendererContext,
	Workspace,
} from "@superset/panes";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
} from "@superset/ui/dropdown-menu";
import { TooltipProvider } from "@superset/ui/tooltip";
import { Folder, Globe, PanelBottom, X } from "lucide-react";
import { type CSSProperties, useEffect, useRef } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { createRoot } from "react-dom/client";
import { useStore } from "zustand";
import { useHotkey } from "../../src/renderer/hotkeys";
import { useHotkeyOverridesStore } from "../../src/renderer/hotkeys/stores/hotkeyOverridesStore";
import {
	attachToContainer,
	createRuntime,
	detachFromContainer,
	disposeRuntime,
	type TerminalRuntime,
} from "../../src/renderer/lib/terminal/terminal-runtime";
import { WorkspaceToolPanels } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceToolPanels";
import {
	createToolPanels,
	mainPaneMinimum,
} from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceToolPanels/tool-panel-store";
import { useDefaultContextMenuActions } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useDefaultContextMenuActions";
import { useDefaultPaneActions } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/useDefaultPaneActions";
import { browserRuntimeRegistry } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/browserRuntimeRegistry";
import { SessionAccountChip } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ClaudeSessionPane/SessionAccountChip";
import { SessionFolderChip } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ClaudeSessionPane/SessionFolderChip";
import { SessionPaneIcon } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ClaudeSessionPane/SessionPaneIcon";
import { TerminalSessionTitle } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/TerminalPane/components/TerminalSessionTitle";
import type { PaneViewerData } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types";
import "@xterm/xterm/css/xterm.css";
import "./test.css";

const tools = createToolPanels({
	key: "isolated-tools",
	storage: localStorage,
	createTerminal: async () => `shell-${crypto.randomUUID()}`,
});
tools.connect();
const main = createWorkspaceStore<PaneViewerData>();
const preview = new URLSearchParams(location.search).has("preview");
main.getState().addTab({
	id: "main",
	panes: [
		{
			id: "session-a",
			kind: "session",
			titleOverride: "GatedSpace Edits",
			data: {},
		},
		{
			id: "session-b",
			kind: preview ? "terminal" : "session",
			titleOverride: preview ? "Codex" : "SecondBrain",
			data: {},
		},
	],
});
// addTab balances vertically; explicitly use a horizontal split in this fixture.
main.getState().replaceState((s) => ({
	...s,
	tabs: s.tabs.map((t) => ({
		...t,
		layout: {
			type: "split",
			direction: "horizontal",
			first: { type: "pane", paneId: "session-a" },
			second: { type: "pane", paneId: "session-b" },
		},
	})),
}));
const runtimes = new Map<string, TerminalRuntime>();
const disposed: string[] = [];
const dragEvents: string[] = [];
function DragMonitor() {
	useDndMonitor({
		onDragStart: (event) => dragEvents.push(`start:${event.active.id}`),
		onDragEnd: (event) => dragEvents.push(`end:${event.over?.id}`),
		onDragCancel: () => dragEvents.push("cancel"),
	});
	return null;
}
function Terminal({ ctx }: { ctx: RendererContext<PaneViewerData> }) {
	const container = useRef<HTMLDivElement>(null);
	useEffect(() => {
		let runtime = runtimes.get(ctx.pane.id);
		if (!runtime) {
			runtime = createRuntime(ctx.pane.id, {
				fontFamily: "Consolas, monospace",
				fontSize: 14,
				background: "#151110",
				theme: { background: "#151110", foreground: "#f2e9e4" },
			});
			runtimes.set(ctx.pane.id, runtime);
			runtime.terminal.write("PS C:\\Dev\\superset> Workspace tools ready\r\n");
		}
		if (container.current)
			attachToContainer(runtime, container.current, () => {});
		return () => detachFromContainer(runtime);
	}, [ctx.pane.id]);
	return (
		<div
			ref={container}
			data-terminal={ctx.pane.id}
			data-focused={ctx.isActive}
			className="h-full w-full min-h-0 overflow-hidden"
		/>
	);
}
function Browser({ ctx }: { ctx: RendererContext<PaneViewerData> }) {
	const container = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (container.current)
			browserRuntimeRegistry.attach(
				ctx.pane.id,
				container.current,
				"about:blank",
				() => {},
			);
		return () => browserRuntimeRegistry.detach(ctx.pane.id);
	}, [ctx.pane.id]);
	return (
		<div
			ref={container}
			data-browser={ctx.pane.id}
			className="h-full min-h-0 w-full bg-background"
		/>
	);
}
const registry: PaneRegistry<PaneViewerData> = {
	session: {
		getTitle: () => "Claude",
		getTabIcon: () => <Folder />,
		renderHeaderLead: (ctx) => <SessionFolderChip paneId={ctx.pane.id} />,
		renderMenuHeader: (ctx) => <SessionAccountChip paneId={ctx.pane.id} />,
		renderHeaderCenter: () => (
			<span className="text-sm text-muted-foreground">1M context</span>
		),
		renderPane: (ctx) => (
			<div
				className="flex h-full flex-col gap-4 p-6"
				data-focused={ctx.isActive}
			>
				<p className="text-muted-foreground">
					Session panes and floating groups stay in place.
				</p>
				<textarea
					aria-label={`Draft ${ctx.pane.id}`}
					defaultValue={`Unsent draft for ${ctx.pane.id}`}
					className="mt-auto resize-none rounded-xl border bg-muted p-4"
				/>
			</div>
		),
		onAfterClose: (pane) => disposed.push(pane.id),
	},
	terminal: {
		getIcon: () => <SessionPaneIcon agentId="codex" />,
		getTitle: () => "Dev",
		getTabIcon: () => <PanelBottom />,
		renderHeaderLead: (ctx) => (
			<SessionFolderChip
				paneId={ctx.pane.id}
				fallbackCwd="C:\\Dev\\SecondBrain"
			/>
		),
		renderTitle: (ctx) => (
			<DropdownMenu>
				<TerminalSessionTitle
					title={ctx.pane.titleOverride ?? "Dev"}
					paneId={ctx.pane.id}
					isActive={ctx.isActive}
					onRename={ctx.actions.setTitle}
				/>
				<DropdownMenuContent align="start">
					<DropdownMenuItem>Codex — current terminal</DropdownMenuItem>
					<DropdownMenuItem>Claude</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		),
		renderPane: (ctx) => <Terminal ctx={ctx} />,
		onAfterClose: (pane) => {
			disposed.push(pane.id);
			const runtime = runtimes.get(pane.id);
			if (runtime) disposeRuntime(runtime);
		},
	},
	browser: {
		getTitle: () => "New tab",
		getTabIcon: () => <Globe />,
		renderPane: (ctx) => <Browser ctx={ctx} />,
		onAfterClose: (pane) => {
			disposed.push(pane.id);
			browserRuntimeRegistry.destroy(pane.id);
		},
	},
	file: {
		getTitle: () => "Unsaved file",
		renderPane: () => <textarea defaultValue="Unsaved work" />,
		onBeforeClose: async () => false,
	},
	"new-tab": {
		getTitle: () => "New pane",
		renderPane: () => (
			<div className="p-6 text-muted-foreground">
				Choose a session, terminal or browser.
			</div>
		),
	},
};
const closeActions = [
	{
		key: "close",
		label: "Close pane",
		tooltip: "Close pane",
		icon: <X />,
		onClick: (ctx: RendererContext<PaneViewerData>) => ctx.actions.close(),
	},
];
const chrome = {
	"--gs-pane-inset": "9px",
	"--gs-pane-radius": "14px",
	"--gs-pane-header-height": "58px",
	"--gs-pane-title-size": "17px",
	"--gs-pane-action-size": "32px",
	"--gs-pane-border-width": "1px",
	"--gs-pane-surface": "#211c19",
	"--gs-pane-well": "color-mix(in oklab, var(--background) 62%, black)",
	"--gs-pane-ring-width": "1px",
	"--gs-pane-ring-glow": "0px",
} as CSSProperties;
function Fixture() {
	const state = useStore(tools.state);
	const layout = useStore(main, (state) => state.tabs[0]?.layout);
	const actions = useDefaultPaneActions({ tools });
	const menus = useDefaultContextMenuActions({
		paneRegistry: registry,
		launcher: { create: async () => `fixture-${crypto.randomUUID()}` } as never,
		workspaceCwd: "C:\\Dev\\superset",
	});
	useHotkey("SPLIT_RIGHT", () => {
		hotkeyCalls.push("split-right");
	});
	useHotkey("SPLIT_DOWN", () => {
		hotkeyCalls.push("split-down");
	});
	useHotkey("SPLIT_WITH_CHAT", () => {
		hotkeyCalls.push("split-chat");
	});
	useHotkey("SPLIT_WITH_BROWSER", () => {
		hotkeyCalls.push("split-browser");
	});
	useHotkey("CLOSE_PANE", () => {
		hotkeyCalls.push("close");
	});
	return (
		<TooltipProvider delayDuration={0}>
			<DndProvider backend={HTML5Backend}>
				<div id="shell" style={chrome}>
					<div id="topbar">
						<strong>GatedSpace</strong>
						<span>Codex　 Claude　 Gemini　 Copilot</span>
						<span id="floating-tabs">Claude　 Claude　 +</span>
					</div>
					{preview && (
						<div className="flex items-center gap-4 px-5 pb-2 text-sm text-muted-foreground">
							<span>
								Interactive header preview · session left, terminal right
							</span>
							<button
								type="button"
								className="rounded border px-3 py-1"
								onClick={() => location.reload()}
							>
								Reset preview
							</button>
						</div>
					)}
					<WorkspaceToolPanels
						tools={tools}
						mainMinimum={mainPaneMinimum(layout, 9)}
						registry={registry}
						paneActions={closeActions}
						contextMenuActions={menus}
						onResizing={(value) =>
							browserRuntimeRegistry.setShellInteractionPassthrough(value)
						}
					>
						<DragMonitor />
						<Workspace
							store={main}
							registry={registry}
							showTabBar={false}
							paneActions={actions}
							contextMenuActions={menus}
							isActive={state.focus === "main"}
						/>
					</WorkspaceToolPanels>
				</div>
			</DndProvider>
		</TooltipProvider>
	);
}
const appRoot = document.getElementById("app");
const hotkeyCalls: string[] = [];
useHotkeyOverridesStore.setState({
	overrides: {
		SPLIT_RIGHT: null,
		SPLIT_DOWN: null,
		SPLIT_WITH_CHAT: null,
		SPLIT_WITH_BROWSER: null,
		CLOSE_PANE: null,
	},
});
if (!appRoot) throw new Error("Missing fixture root");
createRoot(appRoot).render(<Fixture />);
Object.assign(window, {
	toolsTest: {
		hotkeyCalls,
		tools,
		main,
		disposed,
		runtimes,
		registry,
		setShortcut: (value: string | null) =>
			useHotkeyOverridesStore.getState().setOverride("SPLIT_RIGHT", value),
		dragEvents,
		snapshotTerminal() {
			const runtime = [...runtimes.values()][0];
			if (!runtime) throw Error("No terminal");
			const terminal = runtime.terminal;
			const gl = (
				terminal as unknown as {
					_core: {
						_renderService: {
							_renderer: { value: { _gl: WebGL2RenderingContext } };
						};
					};
				}
			)._core._renderService._renderer.value._gl;
			return {
				cols: terminal.cols,
				rows: terminal.rows,
				proposed: runtime.fitAddon.proposeDimensions(),
				viewport: gl ? Array.from(gl.getParameter(gl.VIEWPORT)) : null,
				buffer: gl ? [gl.drawingBufferWidth, gl.drawingBufferHeight] : null,
				domRows:
					terminal.element?.querySelectorAll(".xterm-rows > div").length ?? 0,
			};
		},
		async paintTerminal() {
			const runtime = [...runtimes.values()][0];
			const t = runtime.terminal;
			await new Promise<void>((resolve) =>
				t.write(
					`\x1b[?25l\x1b[2J\x1b[H\x1b[41m  \x1b[0mPS C:\\Dev>\x1b[1;${t.cols - 1}H\x1b[41m  \x1b[${t.rows};1H  \x1b[${t.rows};${t.cols - 1}H  \x1b[0m`,
					resolve,
				),
			);
		},
	},
});
