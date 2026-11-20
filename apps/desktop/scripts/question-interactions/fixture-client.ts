/** Simulated IPC around real question cards and composers. No live agent usage. */
import type { CodexApproval } from "../../src/shared/codex-session/types";
import { electronTrpcClient as base } from "../account-usage-preview/fixture";
import {
	fixture as claude,
	electronTrpcClient as claudeClient,
} from "../claude-questions/fixture-client";

export { electronTrpc } from "../account-usage-preview/fixture";

const listeners = new Set<() => void>();
export const fixture = {
	claude,
	sent: [] as { key: string; text: string }[],
	answers: [] as unknown[],
	failSend: false,
	holdSend: false,
	approval: null as CodexApproval | null,
	pulse() {
		for (const listener of listeners) listener();
	},
	listen(listener: () => void) {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	},
	reset() {
		fixture.sent = [];
		fixture.answers = [];
		fixture.approval = {
			id: crypto.randomUUID(),
			method: "item/tool/requestUserInput",
			title: "Codex question",
			detail: "",
			questions: [{ id: "color", question: "Which color?", options: [] }],
		};
		claude.reset("text");
		fixture.pulse();
	},
	async send(input: { key: string; text: string }) {
		await new Promise((resolve) => setTimeout(resolve, 100));
		if (fixture.failSend) {
			fixture.failSend = false;
			throw new Error("Send failed; your draft is kept.");
		}
		while (fixture.holdSend)
			await new Promise((resolve) => setTimeout(resolve, 20));
		fixture.sent.push(input);
		if (input.key === "question-codex") fixture.approval = null;
		if (input.key === "question-claude") claude.cancel();
		fixture.pulse();
	},
};
export const electronTrpcClient = {
	...base,
	claudeSession: {
		...base.claudeSession,
		...claudeClient.claudeSession,
		models: { query: async () => [] },
	},
	codexSession: {
		...base.codexSession,
		send: { mutate: fixture.send },
		answer: {
			mutate: async (input: unknown) => {
				fixture.answers.push(input);
				fixture.approval = null;
				fixture.pulse();
			},
		},
	},
};
