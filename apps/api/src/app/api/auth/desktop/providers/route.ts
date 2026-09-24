import { env } from "@superset/auth/env";
import { configuredAuthProviders } from "@superset/auth/provider-config";

export function GET() {
	return Response.json(configuredAuthProviders(env), {
		headers: { "Cache-Control": "no-store" },
	});
}
