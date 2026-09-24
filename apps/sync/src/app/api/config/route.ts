import { configuration, providerAvailability } from "@/server/config";
export const dynamic = "force-dynamic";
export async function GET() {
	let configured = false;
	try {
		configuration();
		configured = true;
	} catch {
		/* Initial deployment has no account configuration yet. */
	}
	return Response.json(
		configured ? providerAvailability() : { google: false, github: false },
		{ headers: { "Cache-Control": "no-store" } },
	);
}
