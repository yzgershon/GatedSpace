export const files = [
 {name:'SessionTabs.tsx', language:'tsx', path:'src/components/SessionTabs.tsx', base:`import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";

type Session = {
  id: string;
  title: string;
  provider: "codex" | "claude";
};

type Props = {
  sessions: Session[];
  onCreate: () => void;
};

// Keep navigation reachable, even with a full tab strip.
export function SessionTabs({ sessions, onCreate }: Props) {
  const [selected, setSelected] = useState(sessions[0]?.id);

  return (
    <nav aria-label="Open sessions" className="session-tabs">
      <div role="tablist" className="session-tabs__strip">
`, chunks:[
`        {sessions.map((session) => (
          <button
            key={session.id}
            role="tab"
            aria-selected={selected === session.id}
            onClick={() => setSelected(session.id)}
          >
            {session.title}
          </button>
        ))}
      </div>
`,
`      <div className="session-tabs__actions">
        <button aria-label="Previous tabs"><ChevronLeft /></button>
        <button aria-label="Next tabs"><ChevronRight /></button>
        <button aria-label="New session" onClick={onCreate}>
          <Plus />
        </button>
      </div>
    </nav>
  );
}
`]},
 {name:'session-tabs.css', language:'css', path:'src/components/session-tabs.css', base:`.session-tabs {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 4px;
  padding: 6px;
  background: var(--card);
  border-radius: 12px;
}
`, chunks:[
`
.session-tabs__strip {
  display: flex;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.session-tabs__actions {
  display: flex;
  flex-shrink: 0;
  gap: 4px;
}
`,
`
.session-tabs button {
  display: grid;
  place-items: center;
  min-width: 32px;
  height: 32px;
  border-radius: 8px;
  color: var(--muted-foreground);
}

.session-tabs button[aria-selected="true"] {
  background: var(--accent);
  color: var(--foreground);
}
`]},
 {name:'SessionTabs.test.tsx',language:'tsx',path:'src/components/SessionTabs.test.tsx',base:`import { expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { SessionTabs } from "./SessionTabs";

const sessions = Array.from({ length: 12 }, (_, index) => ({
  id: String(index),
  title: "Session " + (index + 1),
  provider: "codex" as const,
}));
`, chunks:[
`
test("keeps the new-session action outside the scrolling strip", () => {
  render(<SessionTabs sessions={sessions} onCreate={() => {}} />);

  const add = screen.getByRole("button", { name: "New session" });
  const strip = screen.getByRole("tablist");

  expect(strip.contains(add)).toBe(false);
  expect(screen.getAllByRole("tab")).toHaveLength(12);
});
`]},
];
export const steps = [
 {file:0,chunk:0,label:'Reading the tab layout',detail:'Checking how the active tab and fixed actions share the header.'},
 {file:0,chunk:1,label:'Writing SessionTabs.tsx',detail:'Adding selectable sessions with accessible labels.'},
 {file:0,chunk:2,label:'Keeping + in view',detail:'Moving the arrows and New session button outside the scrolling strip.'},
 {file:1,chunk:1,label:'Writing session-tabs.css',detail:'Giving the tab strip flexible space and keeping its controls fixed.'},
 {file:1,chunk:2,label:'Refining compact controls',detail:'Matching the existing Dracula surfaces and smaller button sizes.'},
 {file:2,chunk:1,label:'Adding a regression test',detail:'Covering twelve tabs without losing the New session action.'},
 {file:2,chunk:1,label:'Checking the layout',detail:'Simulating checks at wide and narrow pane sizes.'},
 {file:2,chunk:1,label:'Complete',detail:'Demo complete. Three example files updated; the conversation and draft stayed in place.'},
];
export function contents(index:number,step:number) {
 const count=Math.max(0,...steps.slice(0,step+1).filter(s=>s.file===index).map(s=>s.chunk));
 return files[index].base+files[index].chunks.slice(0,count).join('');
}
