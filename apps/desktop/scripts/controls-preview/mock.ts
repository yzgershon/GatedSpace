export let attempts: unknown[] = [];
let failures = 0;
export function resetReplies(fail = false) {
	attempts = [];
	failures = fail ? 1 : 0;
}
export const electronTrpcClient = {
	codexSession: {
		answer: {
			mutate: async (input: unknown) => {
				attempts.push(input);
				await new Promise((resolve) => setTimeout(resolve, 220));
				if (failures-- > 0)
					throw new Error("Connection interrupted. Your answer is still here.");
				window.dispatchEvent(
					new CustomEvent("preview-reply", { detail: input }),
				);
			},
		},
	},
};
export const useWorkspace = () => ({ workspace: { id: "preview" } });
export const useV2SourcesNotificationStatus = () => null;
export const getV2NotificationSourcesForTab = () => [];
export const getStatusTooltip = () => "Working";
