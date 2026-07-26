import {
	DropdownMenuCheckboxItem,
	DropdownMenuItem,
	DropdownMenuPortal,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
} from "@superset/ui/dropdown-menu";
import { BsTerminalPlus } from "react-icons/bs";
import { HiMiniCommandLine } from "react-icons/hi2";
import { TbHistory, TbWorld } from "react-icons/tb";
import { useIsDarkTheme } from "renderer/assets/app-icons/preset-icons";
import { HotkeyMenuShortcut } from "renderer/components/HotkeyMenuShortcut";
import { useV2AgentConfigs } from "renderer/hooks/useV2AgentConfigs";
import { resolveV2PresetIcon } from "renderer/lib/preset-icon";
import type { V2TerminalPresetRow } from "renderer/routes/_authenticated/providers/CollectionsProvider/dashboardSidebarLocal";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";
import { useLastTerminalAgent } from "renderer/stores/last-terminal-agent";

interface AddTabMenuProps {
	onAddTerminal: () => void;
	onAddBrowser: () => void;
	onOpenSessions: () => void;
	/** The agent presets available in this workspace, in bar order. */
	agentPresets: V2TerminalPresetRow[];
	onRunPreset: (preset: V2TerminalPresetRow) => void | Promise<void>;
	showPresetsBar: boolean;
	onToggleShowPresetsBar: (enabled: boolean) => void;
}

export function AddTabMenu({
	onAddTerminal,
	onAddBrowser,
	onOpenSessions,
	agentPresets,
	onRunPreset,
	showPresetsBar,
	onToggleShowPresetsBar,
}: AddTabMenuProps) {
	const { lastAgentId, setLastAgentId } = useLastTerminalAgent();
	const { activeHostUrl } = useLocalHostService();
	const { data: agents } = useV2AgentConfigs(activeHostUrl);
	const isDark = useIsDarkTheme();

	/**
	 * The resolver returns a data URL, not an element. Dropping it straight into
	 * JSX printed the raw `data:image/svg+xml,...` string as menu text.
	 */
	const iconFor = (preset: V2TerminalPresetRow) => {
		const src = resolveV2PresetIcon(preset, agents ?? [], isDark);
		if (!src) return <HiMiniCommandLine className="size-4 shrink-0" />;
		return (
			<img
				src={src}
				alt=""
				className="size-4 shrink-0 object-contain opacity-90"
			/>
		);
	};

	/**
	 * Only presets bound to an AGENT belong in this submenu.
	 *
	 * `matchedPresets` is every preset in the workspace, which includes the plain
	 * terminal one — it was appearing as a second "terminal" entry beside the
	 * Terminal row that already opens it, and got promoted as "last agent" the
	 * moment it was used.
	 */
	const agentOnly = agentPresets.filter((preset) => Boolean(preset.agentId));

	const runAgent = (preset: V2TerminalPresetRow) => {
		setLastAgentId(preset.id);
		void onRunPreset(preset);
	};

	// The agent you used last gets promoted beside Terminal, so the common case
	// is one click instead of hover-then-click. It's only a shortcut — the same
	// entry is still in the submenu, so the list doesn't reorder under you.
	const lastAgent = agentOnly.find((preset) => preset.id === lastAgentId);

	return (
		<>
			{agentOnly.length > 0 ? (
				<DropdownMenuSub>
					{/*
					 * The trigger is itself clickable: clicking "Terminal" opens a plain
					 * one, hovering reveals the agents. A submenu that ONLY opens on
					 * hover would cost a plain terminal an extra step it never needed.
					 */}
					<DropdownMenuSubTrigger className="gap-2" onClick={onAddTerminal}>
						<BsTerminalPlus className="size-4" />
						<span className="flex-1">Terminal</span>
						<HotkeyMenuShortcut hotkeyId="NEW_GROUP" />
					</DropdownMenuSubTrigger>
					<DropdownMenuPortal>
						<DropdownMenuSubContent>
							{agentOnly.map((preset) => (
								<DropdownMenuItem
									key={preset.id}
									className="gap-2"
									onClick={() => runAgent(preset)}
								>
									{iconFor(preset)}
									<span>{preset.name}</span>
								</DropdownMenuItem>
							))}
						</DropdownMenuSubContent>
					</DropdownMenuPortal>
				</DropdownMenuSub>
			) : (
				<DropdownMenuItem className="gap-2" onClick={onAddTerminal}>
					<BsTerminalPlus className="size-4" />
					<span>Terminal</span>
					<HotkeyMenuShortcut hotkeyId="NEW_GROUP" />
				</DropdownMenuItem>
			)}

			{lastAgent ? (
				<DropdownMenuItem className="gap-2" onClick={() => runAgent(lastAgent)}>
					{iconFor(lastAgent)}
					<span>{lastAgent.name} terminal</span>
				</DropdownMenuItem>
			) : null}

			<DropdownMenuItem className="gap-2" onClick={onAddBrowser}>
				<TbWorld className="size-4" />
				<span>Browser</span>
				<HotkeyMenuShortcut hotkeyId="NEW_BROWSER" />
			</DropdownMenuItem>
			<DropdownMenuItem className="gap-2" onClick={onOpenSessions}>
				<TbHistory className="size-4" />
				<span>Recent sessions</span>
			</DropdownMenuItem>
			<DropdownMenuSeparator />
			<DropdownMenuCheckboxItem
				checked={showPresetsBar}
				onCheckedChange={(checked) => onToggleShowPresetsBar(checked === true)}
				onSelect={(event) => event.preventDefault()}
			>
				Show Preset Bar
			</DropdownMenuCheckboxItem>
		</>
	);
}
