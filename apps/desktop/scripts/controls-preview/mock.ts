export let attempts: unknown[] = [];
let failures = 0;
export function resetReplies(fail = false) {
	attempts = [];
	failures = fail ? 1 : 0;
}
export const electronTrpcClient = {
	window: {
		captureTabThumbnail: {
			query: async () => {
				window.dispatchEvent(new Event("fixture-thumbnail-capture"));
				const canvas = document.createElement("canvas");
				canvas.width = 688;
				canvas.height = 320;
				const context = canvas.getContext("2d");
				if (!context) return null;
				context.fillStyle = "#282a36";
				context.fillRect(0, 0, 688, 320);
				context.fillStyle = "#ff79c6";
				context.font = "24px sans-serif";
				context.fillText("Simulated IPC capture", 24, 50);
				return canvas.toDataURL("image/jpeg");
			},
		},
	},
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
