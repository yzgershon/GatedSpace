import { createWorkspaceStore, type PaneRegistry } from "@superset/panes";
import { TooltipProvider } from "@superset/ui/tooltip";
import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { createRoot } from "react-dom/client";
import { useStore } from "zustand";
import claude from "../../../../packages/ui/src/assets/icons/preset-icons/claude.svg";
import codex from "../../../../packages/ui/src/assets/icons/preset-icons/codex.svg";
import { agentAccent } from "../../src/renderer/lib/agent-accent";
import { TabRail } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/TabRail/TabRail";
import type {
	PaneViewerData,
	SessionPaneData,
} from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types";
import { draculaTheme } from "../../src/shared/themes/built-in/dracula";
import { lightTheme } from "../../src/shared/themes/built-in/light";
import "../../src/renderer/globals.css";
import "./style.css";

const names = [
	"GS Edits",
	"Filtrsoft",
	"Sortie",
	"Emails/texts",
	"Remotion Ads",
	"Research",
];
const store = createWorkspaceStore<PaneViewerData>();
let serial = 0;
function addTab() {
	const n = serial++;
	store.getState().addTab({
		titleOverride: n < names.length ? names[n] : `Session ${n + 1}`,
		panes: [
			{ kind: "session", data: { provider: n % 2 ? "claude" : "codex" } },
		],
	});
}
function reset() {
	for (const tab of [...store.getState().tabs])
		store.getState().removeTab(tab.id);
	serial = 0;
	for (let i = 0; i < 6; i++) addTab();
	store.getState().setActiveTab(store.getState().tabs[0].id);
}
reset();
const registry: PaneRegistry<PaneViewerData> = {
	session: {
		renderPane: () => null,
		getTitle: () => "Session",
		getTabIcon: (pane) => (
			<img
				src={
					(pane.data as SessionPaneData).provider === "codex" ? codex : claude
				}
				width="18"
				height="18"
				alt=""
			/>
		),
	},
};

function Preview() {
	const [width, setWidth] = useState(440);
	const [light, setLight] = useState(false);
	const tabs = useStore(store, (state) => state.tabs);
	const active = useStore(store, (state) => state.activeTabId);
	const tab = tabs.find((item) => item.id === active);
	const pane = tab && Object.values(tab.panes)[0];
	const provider =
		(pane?.data as SessionPaneData | undefined)?.provider ?? "codex";
	useEffect(() => {
		for (const [key, value] of Object.entries(
			(light ? lightTheme : draculaTheme).ui,
		)) {
			if (typeof value === "string")
				document.documentElement.style.setProperty(
					`--${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`,
					value,
				);
		}
		document.documentElement.classList.toggle("dark", !light);
	}, [light]);
	return (
		<main className="floating-preview">
			<header>
				<span className="preview-kicker">GatedSpace / Floating tabs</span>
				<h1>Back to compact.</h1>
				<p>
					Hover to reveal a title. Click to switch. Arrows move through the
					rest.
				</p>
			</header>
			<div className="preview-settings">
				<label className="width-setting">
					Available space <output>{width}px</output>
					<input
						aria-label="Available width"
						type="range"
						min="240"
						max="680"
						step="10"
						value={width}
						onChange={(event) => setWidth(Number(event.target.value))}
					/>
				</label>
				<button type="button" className="preview-button" onClick={reset}>
					<RotateCcw size={14} /> Reset tabs
				</button>
				<button
					type="button"
					className="preview-button"
					aria-pressed={light}
					onClick={() => setLight(!light)}
				>
					{light ? "Dark theme" : "Light theme"}
				</button>
			</div>
			<section className="preview-stage" aria-label="Interactive floating tabs">
				<div className="preview-topbar">
					<div className="preview-rail-slot" style={{ width }}>
						<TabRail
							store={store}
							registry={registry}
							onNewGroup={addTab}
							onCloseGroup={(id) => store.getState().removeTab(id)}
						/>
					</div>
				</div>
				<div
					className="preview-session"
					style={{ borderColor: agentAccent(provider) }}
				>
					<div className="preview-session-heading">
						<img
							src={provider === "codex" ? codex : claude}
							alt=""
							width="18"
							height="18"
						/>
						<h2>{tab?.titleOverride ?? "No sessions"}</h2>
						<span>{provider === "codex" ? "Codex" : "Claude"}</span>
					</div>
					<div className="preview-session-body">
						<p>
							{tab
								? "This is the session you selected."
								: "Use + to open a session."}
						</p>
						<p>
							Try + a few times, narrow the space, then use the arrows. Hovering
							one tab folds the others back to their icons.
						</p>
					</div>
				</div>
			</section>
			<footer>
				<span>Borderless tabs. Centered icons.</span>
				<span>Original height. Titles use only the space they need.</span>
			</footer>
		</main>
	);
}

createRoot(document.body.appendChild(document.createElement("div"))).render(
	<TooltipProvider>
		<DndProvider backend={HTML5Backend}>
			<Preview />
		</DndProvider>
	</TooltipProvider>,
);
