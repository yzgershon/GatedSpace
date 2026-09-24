import { db } from "@superset/db/client";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** A session lookup without a cookie can return 200 without ever reaching the DB. */
export async function GET() {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			db.execute(sql`select 1`),
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error("Database unavailable")),
					3_000,
				);
			}),
		]);
		return Response.json(
			{ ready: true },
			{ headers: { "Cache-Control": "no-store" } },
		);
	} catch {
		return Response.json(
			{ ready: false },
			{ status: 503, headers: { "Cache-Control": "no-store" } },
		);
	} finally {
		clearTimeout(timer);
	}
}
