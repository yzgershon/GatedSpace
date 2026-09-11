import {
	type ContextMenuActionConfig,
	type PaneRegistry,
	type RendererContext,
	requestPaneRename,
} from "@superset/panes";
import { toast } from "@superset/ui/sonner";
import { useCallback, useMemo } from "react";
import { LuClipboard, LuColumns2, LuPencil, LuX } from "react-icons/lu";
import { useCopyToClipboard } from "renderer/hooks/useCopyToClipboard";
import { useHotkeyDisplay } from "renderer/hotkeys";
import type {
	PaneViewerData,
	SessionPaneData,
	TerminalPaneData,
} from "../../types";
import { getSessionCwd } from "../usePaneRegistry/components/ClaudeSessionPane/sessionStore";
import type { TerminalLauncher } from "../useV2TerminalLauncher";

export function useDefaultContextMenuActions({
	launcher,
	workspaceCwd,
}: {
	paneRegistry: PaneRegistry<PaneViewerData>;
	launcher: TerminalLauncher;
	/**
	 * The workspace worktree, used for panes that do not carry their own
	 * directory. A terminal's cwd is resolved host-side and never sent back, and
	 * `resolveTerminalCwd` defaults it to exactly this, so it is the right answer
	 * for every pane that is not a session with an override.
	 */
	workspaceCwd?: string;
}): ContextMenuActionConfig<PaneViewerData>[] {
	const { copyToClipboard } = useCopyToClipboard();
	const splitRightShortcut = useHotkeyDisplay("SPLIT_RIGHT").text;
	const closePaneShortcut = useHotkeyDisplay("CLOSE_PANE").text;

	/**
	 * Where this pane is, for the two folder actions.
	 *
	 * A session pane knows its own directory — it was spawned with one, and a
	 * session resumed from the recent list carries the project it came from
	 * rather than this workspace's worktree, which is why `cwd` exists on
	 * `SessionPaneData` at all. Everything else falls back to the worktree,
	 * which is what `resolveTerminalCwd` gives a terminal anyway.
	 */
	const paneCwd = useCallback(
		(ctx: RendererContext<PaneViewerData>): string | undefined => {
			const sessionCwd = getSessionCwd(ctx.pane.id);
			if (sessionCwd) return sessionCwd;
			const data = ctx.pane.data as Partial<SessionPaneData> | undefined;
			return data?.cwd ?? workspaceCwd;
		},
		[workspaceCwd],
	);

	return useMemo<ContextMenuActionConfig<PaneViewerData>[]>(
		() => [
			{
				key: "rename-pane",
				label: "Rename Pane",
				icon: <LuPencil />,
				shortcut: "F2",
				onSelect: (ctx) => requestPaneRename(ctx.pane.id),
			},
			{
				key: "split-auto",
				label: "Split Pane",
				icon: <LuColumns2 />,
				onSelect: async (ctx) => {
					const terminalId = await launcher.create();
					ctx.actions.split(
						ctx.pane.parentDirection === "horizontal" ? "down" : "right",
						{ kind: "terminal", data: { terminalId } },
					);
				},
			},
			{
				key: "split-vertical",
				label: "Split Vertically",
				icon: <LuColumns2 />,
				shortcut:
					splitRightShortcut !== "Unassigned" ? splitRightShortcut : undefined,
				onSelect: async (ctx) => {
					const terminalId = await launcher.create();
					ctx.actions.split("right", {
						kind: "terminal",
						data: { terminalId } as TerminalPaneData,
					});
				},
			},
			{ key: "sep-folder", type: "separator" },
			{
				key: "copy-cwd",
				label: "Copy Working Directory",
				icon: <LuClipboard />,
				disabled: (ctx) => !paneCwd(ctx),
				onSelect: (ctx) => {
					const cwd = paneCwd(ctx);
					if (!cwd) return;
					toast.promise(copyToClipboard(cwd), {
						success: "Working directory copied",
						error: "Could not copy the working directory",
					});
				},
			},
			{ key: "sep-close", type: "separator" },
			{
				key: "close-pane",
				label: "Close Pane",
				icon: <LuX />,
				variant: "destructive",
				shortcut:
					closePaneShortcut !== "Unassigned" ? closePaneShortcut : undefined,
				onSelect: (ctx) => ctx.actions.close(),
			},
		],
		[splitRightShortcut, closePaneShortcut, launcher, paneCwd, copyToClipboard],
	);
}
