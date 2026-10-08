import {
	type PaneRegistry,
	resolveTabTitle,
	type WorkspaceStore,
} from "@superset/panes";
import { Popover, PopoverContent, PopoverTrigger } from "@superset/ui/popover";
import { useState } from "react";
import { LuCheck, LuChevronDown, LuSearch } from "react-icons/lu";
import type { PaneViewerData } from "../../../../types";

export function TabSwitcher({
	tabs,
	registry,
	activeId,
	onSelect,
}: {
	tabs: WorkspaceStore<PaneViewerData>["tabs"];
	registry: PaneRegistry<PaneViewerData>;
	activeId: string | null;
	onSelect: (id: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const entries = tabs
		.map((tab) => ({ tab, title: resolveTabTitle(tab, tabs, registry) }))
		.filter(({ title }) =>
			title.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
		);
	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (next) setQuery("");
			}}
		>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="gs-tabrail-control gs-tabrail-switcher"
					aria-label={`Find a tab (${tabs.length} open)`}
					title="Find a tab"
				>
					<span>{tabs.length}</span>
					<LuChevronDown size={12} />
				</button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				sideOffset={10}
				className="gs-tab-switcher no-drag"
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						event.stopPropagation();
						setOpen(false);
						return;
					}
					if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
						return;
					const buttons = [
						...event.currentTarget.querySelectorAll<HTMLButtonElement>(
							"[data-tab-choice]",
						),
					];
					const index = buttons.indexOf(
						document.activeElement as HTMLButtonElement,
					);
					if ((event.key === "Home" || event.key === "End") && index < 0)
						return;
					event.preventDefault();
					const next =
						event.key === "Home"
							? 0
							: event.key === "End"
								? buttons.length - 1
								: event.key === "ArrowDown"
									? (index + 1) % buttons.length
									: (index <= 0 ? buttons.length : index) - 1;
					buttons[next]?.focus();
				}}
			>
				<label className="gs-tab-switcher-search">
					<LuSearch size={16} />
					<input
						aria-label="Search open tabs"
						placeholder="Find a conversation..."
						value={query}
						onChange={(event) => setQuery(event.target.value)}
					/>
				</label>
				<section
					className="gs-tab-switcher-results"
					aria-label="Open conversations"
				>
					{entries.map(({ tab, title }) => {
						const pane =
							tab.panes[tab.activePaneId ?? ""] ?? Object.values(tab.panes)[0];
						return (
							<button
								type="button"
								key={tab.id}
								data-tab-choice=""
								aria-label={title}
								aria-current={activeId === tab.id ? "true" : undefined}
								onClick={() => {
									onSelect(tab.id);
									setOpen(false);
								}}
							>
								<span className="gs-tab-switcher-icon">
									{pane && registry[pane.kind]?.getTabIcon?.(pane)}
								</span>
								<span>{title}</span>
								{tab.id === activeId && (
									<LuCheck size={15} aria-label="Active" />
								)}
							</button>
						);
					})}
					{!entries.length && <p>No matching conversations</p>}
				</section>
				<footer>
					{tabs.length} open · Arrow keys to browse · Enter to open
				</footer>
			</PopoverContent>
		</Popover>
	);
}
