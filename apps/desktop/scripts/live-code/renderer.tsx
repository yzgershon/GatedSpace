import type { RendererContext } from "@superset/panes";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { LiveCodeButton } from "../../src/renderer/components/LiveCode/LiveCodeButton";
import { LiveCodeLayout } from "../../src/renderer/components/LiveCode/LiveCodeLayout";
import { publishCodexSession } from "../../src/renderer/lib/codex-session/store";
import type { PaneViewerData } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types";
import type { CodexSessionState } from "../../src/shared/codex-session/types";
import { draculaTheme } from "../../src/shared/themes/built-in/dracula";
import "../../src/renderer/globals.css";
for (const [key, value] of Object.entries(draculaTheme.ui))
	if (typeof value === "string")
		document.documentElement.style.setProperty(
			`--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`,
			value,
		);
const fixture = window as unknown as {
	live: {
		reads: number;
		watches: number;
		mounts: number;
		content: string;
		maximized?: string | null;
		listeners: Set<
			(batch: { events: { absolutePath: string; kind: string }[] }) => void
		>;
		state: CodexSessionState;
		edit: (path: string, text: string) => void;
		save: (text: string) => void;
	};
};
fixture.live = {
	edit: () => {},
	save: () => {},
	reads: 0,
	watches: 0,
	mounts: 0,
	content: 'export const label = "original";\n',
	listeners: new Set(),
	state: {
		key: "live-test",
		threadId: "thread",
		title: "Live code",
		model: "model",
		effort: "high",
		error: null,
		historyCursor: null,
		diff: "",
		contextTokens: null,
		contextWindow: null,
		cwd: "C:/Dev/superset",
		status: "working",
		turnId: "turn",
		items: [],
		turns: [],
		approvals: [],
	},
};
fixture.live.edit = (path: string, text: string) => {
	fixture.live.content = text;
	fixture.live.state = {
		...fixture.live.state,
		items: [
			...fixture.live.state.items,
			{
				id: String(Date.now()),
				kind: "activity",
				title: "Editing file",
				text: "",
				turnId: "turn",
				status: "completed",
				changes: [{ path, diff: text, kind: "update" }],
			},
		],
	};
	publishCodexSession(fixture.live.state);
};
fixture.live.save = (text: string) => {
	fixture.live.content = text;
	for (const listener of fixture.live.listeners)
		listener({
			events: [{ absolutePath: "C:/Dev/superset/a.ts", kind: "change" }],
		});
};
function Conversation() {
	const [draft, setDraft] = useState("Unsent draft");
	useEffect(() => {
		fixture.live.mounts++;
	}, []);
	return (
		<div
			style={{
				padding: 16,
				display: "flex",
				flexDirection: "column",
				height: "100%",
			}}
		>
			<strong>Existing conversation</strong>
			<p>The same session stays here.</p>
			<textarea
				aria-label="Draft"
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				style={{ marginTop: "auto", width: "100%", height: 110 }}
			/>
		</div>
	);
}
function App() {
	const context = {
		pane: { id: "live-test", kind: "session" },
		tab: { id: "tab" },
		store: {
			getState: () => ({
				getTab: () => ({
					id: "tab",
					panes: { "live-test": {} },
					maximizedPaneId: fixture.live.maximized,
				}),
				toggleMaximizePane: () => {
					fixture.live.maximized = fixture.live.maximized ? null : "live-test";
				},
			}),
		},
		actions: { focus: () => {} },
	} as unknown as RendererContext<PaneViewerData>;
	return (
		<main
			style={{
				height: "100dvh",
				display: "flex",
				flexDirection: "column",
				background: "var(--card)",
			}}
		>
			<header
				style={{
					height: 50,
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					padding: "0 16px",
				}}
			>
				Live code production fixture
				<LiveCodeButton context={context} />
			</header>
			<LiveCodeLayout
				paneId="live-test"
				workspaceId="workspace"
				provider="codex"
				cwd="C:/Dev/superset"
			>
				<Conversation />
			</LiveCodeLayout>
		</main>
	);
}
const node = document.createElement("div");
document.body.append(node);
createRoot(node).render(<App />);
