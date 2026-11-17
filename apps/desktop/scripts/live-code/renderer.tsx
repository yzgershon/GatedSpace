import type { RendererContext } from "@superset/panes";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { LiveCodeButton } from "../../src/renderer/components/LiveCode/LiveCodeButton";
import { LiveCodeLayout } from "../../src/renderer/components/LiveCode/LiveCodeLayout";
import {
	absoluteCodePath,
	snapshotPatch,
} from "../../src/renderer/components/LiveCode/live-code-files";
import { useLiveCodeState } from "../../src/renderer/components/LiveCode/live-code-state";
import { publishCodexSession } from "../../src/renderer/lib/codex-session/store";
import type { PaneViewerData } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types";
import type { CodexSessionState } from "../../src/shared/codex-session/types";
import { draculaTheme } from "../../src/shared/themes/built-in/dracula";
import "../../src/renderer/globals.css";
import "./preview.css";
const demo = !location.search.includes("test");
const sample = `import { useMemo, useState } from "react";
import { SessionCard } from "./SessionCard";
import type { Session } from "../types";

interface SessionListProps {
  sessions: Session[];
  onOpen: (id: string) => void;
}

export function SessionList({ sessions, onOpen }: SessionListProps) {
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const search = query.trim().toLowerCase();
    return sessions.filter((session) =>
      session.title.toLowerCase().includes(search)
    );
  }, [sessions, query]);

  return (
    <section className="session-list">
      <input
        aria-label="Search sessions"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Find a conversation…"
      />
      <div className="session-grid">
        {visible.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            onOpen={() => onOpen(session.id)}
          />
        ))}
      </div>
    </section>
  );
}
`;
const improved = sample.replace(
	"session.title.toLowerCase().includes(search)",
	"[session.title, session.project, session.summary]\n        .some((value) => value.toLowerCase().includes(search))",
);
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
		files: Record<string, string>;
		error?: string;
		onWatchError?: (error: { message: string }) => void;
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
	files: {},
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
	const fullPath = absoluteCodePath(fixture.live.state.cwd, path);
	const before = fixture.live.files[fullPath] ?? "";
	fixture.live.content = text;
	fixture.live.files[fullPath] = text;
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
				changes: [{ path, diff: snapshotPatch(before, text), kind: "update" }],
			},
		],
	};
	publishCodexSession(fixture.live.state);
};
fixture.live.save = (text: string) => {
	fixture.live.content = text;
	fixture.live.files["C:/Dev/superset/a.ts"] = text;
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
		<div className="live-demo-conversation">
			<header>
				<strong>Conversation</strong>
				<span>Codex</span>
			</header>
			<div className="live-demo-transcript">
				<div className="live-demo-prompt">
					Let me search by something I remember saying, even when I’ve forgotten
					the session title.
				</div>
				<p>
					I’ll include the project and conversation summary in search, while
					keeping the results quick to scan.
				</p>
				<div className="live-demo-action">
					<span>↳</span> Updating SessionList.tsx
				</div>
				<p>
					The search now checks all three fields. You can inspect the changes in
					the editor beside this conversation.
				</p>
				<div className="live-demo-artifact">
					<span>SessionList.tsx</span>
					<b>+2 −1</b>
				</div>
			</div>
			<div className="live-demo-composer">
				<textarea
					aria-label="Draft"
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
				/>
				<div>
					<span>+</span>
					<span>↑</span>
				</div>
			</div>
		</div>
	);
}
function App() {
	useEffect(() => {
		if (!demo) return;
		fixture.live.edit(
			"src/styles/sessions.css",
			".session-grid {\n  display: grid;\n  gap: 12px;\n}\n",
		);
		fixture.live.edit(
			"src/types.ts",
			"export interface Session {\n  id: string;\n  title: string;\n  project: string;\n  summary: string;\n}\n",
		);
		fixture.live.edit("src/components/SessionList.tsx", sample);
		useLiveCodeState.setState({
			panes: { "live-test": { restoreMaximized: null } },
		});
	}, []);
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
				<span style={{ fontSize: 13, fontWeight: 600 }}>
					Live code{" "}
					<small
						style={{
							fontWeight: 400,
							color: "var(--muted-foreground)",
							marginLeft: 10,
						}}
					>
						Source preview · simulated edits
					</small>
				</span>
				{demo && (
					<button
						className="live-demo-replay"
						type="button"
						onClick={() =>
							fixture.live.edit(
								"src/components/SessionList.tsx",
								fixture.live.content === improved ? sample : improved,
							)
						}
					>
						Play edit
					</button>
				)}
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
