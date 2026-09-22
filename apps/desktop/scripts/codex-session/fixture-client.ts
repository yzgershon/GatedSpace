import type { CodexSessionState } from "../../src/shared/codex-session/types";

const states = new Map<string, CodexSessionState>();
const listeners = new Map<string, Set<(value: CodexSessionState) => void>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const publish = (key: string) => {
	const value = states.get(key);
	if (value)
		for (const fn of listeners.get(key) ?? []) fn(structuredClone(value));
};
Object.assign(window, {
	setCodexActivityFixture: (patch: Partial<CodexSessionState>) => {
		Object.assign(state("fixture"), patch);
		publish("fixture");
	},
});
function state(key: string): CodexSessionState {
	let s = states.get(key);
	if (s) return s;
	s = {
		key,
		threadId: `thread-${key}`,
		cwd: "C:\\Dev\\superset",
		title: "Native Codex in GatedSpace",
		model: "gpt-6-astra",
		effort: "xhigh",
		status: "idle",
		turnId: null,
		error: null,
		historyCursor: "older",
		approvals: [],
		contextTokens: 42000,
		contextWindow: 272000,
		diff: "diff --git a/panels.ts b/panels.ts\n- resetPanel()\n+ restorePanel()",
		items: [
			{
				id: "user",
				turnId: "one",
				kind: "user",
				title: "",
				text: "Make the workspace panels feel smoother. Keep the selected tab when I reopen the sidebar, and keep my pane layout.",
			},
			{
				id: "comment",
				turnId: "one",
				kind: "assistant",
				phase: "commentary",
				title: "",
				text: "I’ll check how the panels keep their state, then tighten the transitions without changing your pane layout.",
			},
			{
				id: "tool",
				turnId: "one",
				kind: "activity",
				title: "Read WorkspaceToolPanels.tsx and 3 related files",
				text: "Panel state is shared by the workspace.",
				status: "completed",
			},
			{
				id: "assistant",
				turnId: "one",
				kind: "assistant",
				title: "",
				text: "The panels now reopen exactly where you left them.\n\n- **Your active tab stays selected.** Closing a panel keeps the browser, terminal, and files ready.\n- **Opening and closing feels continuous.** A short transition makes room for the panel.\n- **Split panes stay clean.** One set of panel controls stays in the pane header.\n\nThe panel checks pass. You can review the changes below.",
			},
		],
	};
	if (location.search.includes("paired")) {
		s.items = [];
		s.diff = "";
		s.historyCursor = null;
	}
	states.set(key, s);
	return s;
}
export const electronTrpcClient = {
	claudeSession: {
		answerPermission: {
			mutate: async () =>
				window.dispatchEvent(new Event("fixture-claude-permission")),
		},
	},
	codexSession: {
		skills: {
			query: async () => [
				{
					name: "design",
					description: "Design this app",
					path: "C:/skills/design/SKILL.md",
				},
			],
		},
		command: {
			mutate: async (input: { key: string; command: string }) => {
				const s = state(input.key);
				s.items.push({
					id: crypto.randomUUID(),
					turnId: "command",
					kind: "activity",
					title: `Running ${input.command}`,
					text: "",
					status: "completed",
				});
				publish(input.key);
			},
		},
		models: {
			query: async () => [
				{
					id: "gpt-6-astra",
					name: "GPT-6 Astra",
					efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
					defaultEffort: "medium",
				},
			],
		},
		account: {
			query: async () => ({
				signedIn: true,
				label: "Personal account",
				plan: "pro",
			}),
		},
		start: {
			mutate: async ({ key }: { key: string }) => structuredClone(state(key)),
		},
		stream: {
			subscribe: (
				{ key }: { key: string },
				handlers: { onData: (s: CodexSessionState) => void },
			) => {
				let set = listeners.get(key);
				if (!set) {
					set = new Set();
					listeners.set(key, set);
				}
				set.add(handlers.onData);
				return { unsubscribe: () => set.delete(handlers.onData) };
			},
		},
		send: {
			mutate: async (input: { key: string; text: string }) => {
				const s = state(input.key);
				if (input.text === "simulate failure")
					throw new Error("Connection unavailable. Your draft is safe.");
				s.items.push({
					id: crypto.randomUUID(),
					turnId: "two",
					kind: "user",
					title: "",
					text: input.text,
				});
				s.status = "working";
				s.turnId = "two";
				publish(input.key);
				timers.set(
					input.key,
					setTimeout(
						() => {
							s.items.push({
								id: crypto.randomUUID(),
								turnId: "two",
								kind: "assistant",
								title: "",
								text: "Done. Your workspace layout is preserved.",
							});
							s.status = "idle";
							s.turnId = null;
							publish(input.key);
						},
						input.text === "Delayed first response" ? 3000 : 700,
					),
				);
			},
		},
		interrupt: {
			mutate: async ({ key }: { key: string }) => {
				clearTimeout(timers.get(key));
				const s = state(key);
				s.status = "idle";
				s.turnId = null;
				publish(key);
			},
		},
		earlier: {
			mutate: async ({ key }: { key: string }) => {
				const s = state(key);
				s.items.unshift({
					id: "older",
					turnId: "old",
					kind: "user",
					title: "",
					text: "Earlier conversation restored.",
				});
				s.historyCursor = null;
				return structuredClone(s);
			},
		},
		answer: {
			mutate: async ({ key }: { key: string }) => {
				const s = state(key);
				s.approvals = [];
				s.status = "idle";
				publish(key);
			},
		},
	},
};
Object.assign(window, {
	codexFixture: {
		approval() {
			const s = state("fixture");
			s.status = "working";
			s.approvals = [
				{
					id: "approval",
					method: "item/commandExecution/requestApproval",
					title: "Approval needed",
					detail: "Run the workspace test suite?",
					questions: [],
				},
			];
			publish(s.key);
		},
	},
});
