import {
	type CreatePaneInput,
	createWorkspaceStore,
	type LayoutNode,
	type WorkspaceState,
} from "@superset/panes";
import { sanitizePaneLayout } from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal/schema";
import { createStore } from "zustand/vanilla";
import type { PaneViewerData } from "../../types";

export type ToolPlacement = "right" | "bottom";
export type ToolKind = "files" | "changes" | "browser" | "terminal" | "session";
interface PanelState {
	open: boolean;
	size: number;
	activeTabId: string | null;
}
export interface ToolPanelState {
	right: PanelState;
	bottom: PanelState;
	placement: Record<string, ToolPlacement>;
	focus: "main" | ToolPlacement;
}
export const panelDefaults = { right: 420, bottom: 300 };

/** Preserve the pane grid's existing minimums while allocating space to tools. */
export function mainPaneMinimum(
	layout: LayoutNode | undefined,
	inset: number,
): { width: number; height: number } {
	function measure(node: LayoutNode): { width: number; height: number } {
		if (node.type === "pane")
			return { width: 260 + 2 * inset, height: 160 + 2 * inset };
		const a = measure(node.first),
			b = measure(node.second);
		return node.direction === "horizontal"
			? { width: a.width + b.width + 1, height: Math.max(a.height, b.height) }
			: { width: Math.max(a.width, b.width), height: a.height + b.height + 1 };
	}
	const size = layout ? measure(layout) : { width: 0, height: 0 };
	return {
		width: Math.max(400, size.width + 2 * inset),
		height: Math.max(260, size.height + 2 * inset),
	};
}

/** The upper-right visible leaf owns the one pair of shared panel controls. */
export function panelButtonOwner(layout: LayoutNode): string {
	if (layout.type === "pane") return layout.paneId;
	return panelButtonOwner(
		layout.direction === "horizontal" ? layout.second : layout.first,
	);
}

export function createToolPanels({
	key,
	storage,
	createTerminal,
	cwd,
}: {
	key: string;
	storage?: Pick<Storage, "getItem" | "setItem">;
	createTerminal: () => Promise<string>;
	cwd?: string;
}) {
	let layout: WorkspaceState<PaneViewerData> = {
		version: 1,
		tabs: [],
		activeTabId: null,
	};
	const initial: ToolPanelState = {
		right: { open: false, size: panelDefaults.right, activeTabId: null },
		bottom: { open: false, size: panelDefaults.bottom, activeTabId: null },
		placement: {},
		focus: "main",
	};
	try {
		const saved = JSON.parse(storage?.getItem(key) ?? "null");
		if (saved?.version === 1) {
			layout = sanitizePaneLayout(
				saved.layout,
			) as WorkspaceState<PaneViewerData>;
			for (const tab of layout.tabs)
				initial.placement[tab.id] =
					saved.placement?.[tab.id] === "bottom" ? "bottom" : "right";
			for (const side of ["right", "bottom"] as const) {
				const panel = saved[side];
				initial[side] = {
					open: panel?.open === true,
					size:
						typeof panel?.size === "number" && Number.isFinite(panel.size)
							? Math.max(180, Math.min(900, panel.size))
							: panelDefaults[side],
					activeTabId:
						layout.tabs.find(
							(t) =>
								t.id === panel?.activeTabId && initial.placement[t.id] === side,
						)?.id ??
						layout.tabs.find((t) => initial.placement[t.id] === side)?.id ??
						null,
				};
			}
		}
	} catch {
		/* Unreadable storage must not prevent opening the workspace. */
	}
	const store = createWorkspaceStore<PaneViewerData>({ initialState: layout });
	const state = createStore<ToolPanelState>(() => initial);
	const pending = new Map<ToolPlacement, Promise<void>>();
	let creating = false;
	function focus(side: "main" | ToolPlacement) {
		if (state.getState().focus !== side) state.setState({ focus: side });
		if (side !== "main") {
			const id = state.getState()[side].activeTabId;
			if (id) store.getState().setActiveTab(id);
		}
	}
	function select(tabId: string) {
		const side = state.getState().placement[tabId] ?? "right";
		state.setState((s) => ({
			[side]: { ...s[side], open: true, activeTabId: tabId },
			focus: side,
		}));
		store.getState().setActiveTab(tabId);
	}
	function add(
		side: ToolPlacement,
		pane: CreatePaneInput<PaneViewerData>,
		activate = true,
	) {
		const tabId = `tool-${crypto.randomUUID()}`;
		state.setState((s) => ({ placement: { ...s.placement, [tabId]: side } }));
		creating = true;
		try {
			store.getState().addTab({ id: tabId, panes: [pane] });
		} finally {
			creating = false;
		}
		if (activate) select(tabId);
		return tabId;
	}
	async function open(side: ToolPlacement, kind: ToolKind) {
		if (kind === "terminal") setOpen(side, true);
		if (kind === "files" || kind === "changes") {
			const existing = store
				.getState()
				.tabs.find((t) => Object.values(t.panes).some((p) => p.kind === kind));
			if (existing) {
				select(existing.id);
				return;
			}
		}
		const data =
			kind === "terminal"
				? { terminalId: await createTerminal() }
				: kind === "browser"
					? { url: "about:blank" }
					: kind === "session"
						? { cwd }
						: {};
		add(
			side,
			{ kind, data },
			kind !== "terminal" || state.getState()[side].open,
		);
	}
	function setOpen(side: ToolPlacement, open: boolean) {
		state.setState((s) => ({
			[side]: { ...s[side], open },
			focus: open ? side : s.focus === side ? "main" : s.focus,
		}));
	}
	async function toggle(side: ToolPlacement) {
		const panel = state.getState()[side];
		if (panel.open) {
			setOpen(side, false);
			return;
		}
		setOpen(side, true);
		if (
			store
				.getState()
				.tabs.some((t) => state.getState().placement[t.id] === side)
		) {
			focus(side);
			return;
		}
		// An empty right panel presents its tool chooser; opening it is not a
		// request to create a browser. The bottom panel still defaults to a shell.
		if (side === "right") return;
		if (pending.has(side)) return pending.get(side);
		const task = (async () => {
			const pane = {
				kind: "terminal",
				data: { terminalId: await createTerminal() },
			};
			// A slow shell launch must not undo a subsequent Hide click.
			add(side, pane, state.getState()[side].open);
		})().finally(() => pending.delete(side));
		pending.set(side, task);
		return task;
	}
	function move(tabId: string, side: ToolPlacement, beforeId?: string) {
		if (!store.getState().getTab(tabId)) return;
		state.setState((s) => ({ placement: { ...s.placement, [tabId]: side } }));
		const tabs = store.getState().tabs;
		store.getState().reorderTab({
			tabId,
			toIndex: beforeId
				? Math.max(
						0,
						tabs.findIndex((t) => t.id === beforeId),
					)
				: tabs.length - 1,
		});
		select(tabId);
	}
	function resize(side: ToolPlacement, size: number) {
		if (!Number.isFinite(size)) return;
		state.setState((s) => ({
			[side]: { ...s[side], size: Math.max(180, Math.min(900, size)) },
		}));
	}
	function connect() {
		function reconcile() {
			const tabs = store.getState().tabs;
			state.setState((s) => {
				const placement = Object.fromEntries(
					tabs.map((t) => [
						t.id,
						s.placement[t.id] ?? (s.focus === "bottom" ? "bottom" : "right"),
					]),
				);
				const repair = (side: ToolPlacement) => ({
					...s[side],
					activeTabId:
						tabs.find(
							(t) => t.id === s[side].activeTabId && placement[t.id] === side,
						)?.id ??
						tabs.find((t) => placement[t.id] === side)?.id ??
						null,
				});
				return { placement, right: repair("right"), bottom: repair("bottom") };
			});
		}
		let timer: ReturnType<typeof setTimeout> | undefined;
		function save() {
			clearTimeout(timer);
			timer = setTimeout(flush, 120);
		}
		function flush() {
			clearTimeout(timer);
			const { focus: _focus, ...panels } = state.getState();
			const { tabs, activeTabId } = store.getState();
			try {
				storage?.setItem(
					key,
					JSON.stringify({
						version: 1,
						...panels,
						layout: { version: 1, tabs, activeTabId },
					}),
				);
			} catch (error) {
				console.error("Could not save workspace tool panels", error);
			}
		}
		const offLayout = store.subscribe((next, prev) => {
			if (next.tabs !== prev.tabs) reconcile();
			const previousActivePane = prev.tabs.find(
				(tab) => tab.id === prev.activeTabId,
			)?.activePaneId;
			const closedActivePane =
				previousActivePane &&
				!next.tabs.some((tab) => tab.panes[previousActivePane]);
			if (
				!creating &&
				!closedActivePane &&
				next.activeTabId &&
				next.activeTabId !== prev.activeTabId
			) {
				const id = next.activeTabId;
				const side = state.getState().placement[id];
				if (side)
					state.setState((s) => ({
						[side]: { ...s[side], activeTabId: id, open: true },
						focus: side,
					}));
			}
			save();
		});
		const offState = state.subscribe(save);
		if (typeof window !== "undefined")
			window.addEventListener("pagehide", flush);
		return () => {
			if (typeof window !== "undefined")
				window.removeEventListener("pagehide", flush);
			offLayout();
			offState();
			flush();
		};
	}
	return {
		store,
		state,
		add,
		open,
		toggle,
		setOpen,
		select,
		move,
		resize,
		focus,
		connect,
	};
}
export type ToolPanels = ReturnType<typeof createToolPanels>;
