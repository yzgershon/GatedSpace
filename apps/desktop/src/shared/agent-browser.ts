import { z } from "zod";
import { isLocalPreviewUrl } from "./local-preview";

export interface BrowserPanelRequest {
	requestId: string;
	workspaceId: string;
	sessionKey: string;
	knownPaneIds: string[];
	action: "open" | "list" | "select";
	paneId?: string;
	url?: string;
}

export const browserPanelResultSchema = z.object({
	paneId: z.string().optional(),
	reused: z.boolean().optional(),
	tabs: z.array(
		z.object({
			tabId: z.string(),
			url: z.string(),
			title: z.string(),
			active: z.boolean(),
		}),
	),
});
export type BrowserPanelResult = z.infer<typeof browserPanelResultSchema>;

/** Normalize browser URL syntax without conflating routes, queries or anchors. */
export function browserUrlKey(value: string): string | null {
	try {
		const url = new URL(value);
		return (["http:", "https:"].includes(url.protocol) ||
			isLocalPreviewUrl(value)) &&
			!url.username &&
			!url.password
			? url.href
			: null;
	} catch {
		return null;
	}
}
