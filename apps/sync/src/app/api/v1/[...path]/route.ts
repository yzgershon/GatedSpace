import { services } from "@/server/auth";
import { privateBlobs } from "@/server/blobs";
import { createSyncHandler } from "@/server/http";
import { CheckpointStore } from "@/server/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
async function handler(request: Request) {
	const { auth, db, config } = services();
	return createSyncHandler({
		store: new CheckpointStore(db),
		blobs: privateBlobs,
		authenticate: async (request) => {
			const session = await auth.api.getSession({ headers: request.headers });
			if (
				!session?.user.emailVerified ||
				!config.allowedEmails.includes(session.user.email.toLowerCase())
			)
				return null;
			return { id: session.user.id, email: session.user.email };
		},
	})(request);
}
export {
	handler as GET,
	handler as PUT,
	handler as POST,
	handler as PATCH,
	handler as DELETE,
};
