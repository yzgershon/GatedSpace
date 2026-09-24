import { sql } from "drizzle-orm";
import { services } from "@/server/auth";
import { providerAvailability } from "@/server/config";
export const dynamic = "force-dynamic";
export async function GET() {
	try {
		// Missing migrations must never look healthy just because Postgres answers.
		await services().db.execute(sql`select u.id, s.token, d.device_code, c.id, o.digest, q.bytes
		from continuity.users u
		left join continuity.sessions s on false
		left join continuity.device_codes d on false
		left join continuity.checkpoints c on false
		left join continuity.objects o on false
		left join continuity.quotas q on false limit 0`);
		const providers = providerAvailability();
		if (!providers.google && !providers.github)
			throw new Error("Sign-in needs configuration");
		return Response.json(
			{ ready: true, protocol: 1 },
			{ headers: { "Cache-Control": "no-store" } },
		);
	} catch {
		return Response.json(
			{ ready: false },
			{ status: 503, headers: { "Cache-Control": "no-store" } },
		);
	}
}
