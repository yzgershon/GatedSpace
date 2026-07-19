import { env } from "@/env";

/**
 * Browser and desktop traffic stays on the local API URL. OAuth providers,
 * webhook senders, and QStash need a stable publicly reachable HTTPS origin.
 */
export const integrationsPublicApiUrl = (
	env.INTEGRATIONS_PUBLIC_API_URL ?? env.NEXT_PUBLIC_API_URL
).replace(/\/$/, "");

export function integrationsPublicUrl(path: `/${string}`): string {
	return `${integrationsPublicApiUrl}${path}`;
}
