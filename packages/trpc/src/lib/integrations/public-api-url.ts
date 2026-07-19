import { env } from "../../env";

const integrationsPublicApiUrl = (
	env.INTEGRATIONS_PUBLIC_API_URL ?? env.NEXT_PUBLIC_API_URL
).replace(/\/$/, "");

export function integrationsPublicUrl(path: `/${string}`): string {
	return `${integrationsPublicApiUrl}${path}`;
}
