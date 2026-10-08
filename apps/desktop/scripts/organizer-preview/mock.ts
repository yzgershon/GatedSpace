import claude from "../../../../packages/ui/src/assets/icons/preset-icons/claude.svg";
import codex from "../../../../packages/ui/src/assets/icons/preset-icons/codex.svg";
import type { OrganizationCommand } from "../../src/shared/session-organization";
export const usePresetIcon = (provider: string) =>
	provider === "codex" ? codex : claude;
export const useLocalHostService = () => ({
	activeHostUrl: "isolated-preview",
});
export const useCopyToClipboard = () => ({ copyToClipboard: async () => {} });
export const getHostTrpcClient = () => ({
	terminalAgents: { list: { query: async () => [] } },
});
async function api(path: string, input?: unknown) {
	const response = await fetch(
		`/api/${path}`,
		input === undefined
			? undefined
			: {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(input),
				},
	);
	const result = await response.json();
	if (!response.ok) throw new Error(result.error);
	return result;
}
export const electronTrpcClient = {
	claudeSessions: {
		organization: { query: () => api("organization") },
		organize: {
			mutate: (input: OrganizationCommand) => api("organize", input),
		},
		watchOrganization: { subscribe: () => ({ unsubscribe() {} }) },
		list: { query: (input: unknown) => api("sessions", input) },
		searchContent: { query: async () => [] },
		pin: { mutate: (input: unknown) => api("pin", input) },
		setArchived: { mutate: (input: unknown) => api("archive", input) },
		rename: { mutate: (input: unknown) => api("rename", input) },
	},
	claudeSession: { liveSessionIds: { query: async () => [] } },
	codexSession: { liveSessionIds: { query: async () => [] } },
	notifications: {
		sessionStates: {
			subscribe: (_: unknown, handlers: { onData: (s: unknown[]) => void }) => {
				handlers.onData([
					{
						provider: "codex",
						sessionId: "00000000-0000-4000-8000-000000000001",
						status: "working",
					},
				]);
				return { unsubscribe() {} };
			},
		},
	},
};
