import { z } from "zod";
import type { SessionData } from "./auth-client";

const identifier = z.string().min(1).max(200);
const cachedSessionSchema = z.object({
	user: z.object({
		id: identifier,
		name: z.string().max(200),
		email: z.string().max(320),
		emailVerified: z.boolean(),
		createdAt: z.coerce.date(),
		updatedAt: z.coerce.date(),
		onboardedAt: z.coerce.date().nullable(),
		image: z.null(),
	}),
	session: z.object({
		id: identifier,
		userId: identifier,
		token: z.literal(""),
		ipAddress: z.literal(""),
		userAgent: z.literal(""),
		createdAt: z.coerce.date(),
		updatedAt: z.coerce.date(),
		expiresAt: z.coerce.date(),
		activeOrganizationId: identifier,
		organizationIds: z.array(identifier).min(1).max(128),
		role: z.string().max(40).optional(),
		plan: z.string().max(40),
	}),
});
const envelopeSchema = z.object({
	credentialHash: z.string().regex(/^[a-f0-9]{64}$/),
	data: cachedSessionSchema,
});

export function isWorkspaceSessionCacheEnabled(apiUrl: string): boolean {
	try {
		const url = new URL(apiUrl);
		return (
			url.protocol === "http:" &&
			(url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
			!url.username &&
			!url.password
		);
	} catch {
		return false;
	}
}

/** Local workspace identity only. Never stores credentials or authenticates API calls. */
export function createWorkspaceSessionCache(
	apiUrl: string,
	storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem">,
) {
	const enabled = isWorkspaceSessionCacheEnabled(apiUrl);
	const key = `gatedspace:workspace-session:v1:${apiUrl}`;
	const listeners = new Set<() => void>();
	let snapshot: SessionData | null = null;
	let generation = 0;
	let credentialHash: string | null = null;
	let credential: string | null = null;
	let lastEncoded: string | null = null;
	let ready = Promise.resolve();
	const notify = () => {
		for (const listener of listeners) listener();
	};

	return {
		getSnapshot: () => snapshot,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		setCredential(token: string | null): Promise<void> {
			if (token && token === credential) return ready;
			const version = ++generation;
			credential = token;
			credentialHash = null;
			lastEncoded = null;
			if (snapshot) {
				snapshot = null;
				notify();
			}
			if (!enabled || !token) {
				if (!token && enabled) {
					try {
						storage().removeItem(key);
					} catch {}
				}
				return Promise.resolve();
			}
			ready = (async () => {
				try {
					const digest = await crypto.subtle.digest(
						"SHA-256",
						new TextEncoder().encode(token),
					);
					if (version !== generation) return;
					credentialHash = Array.from(new Uint8Array(digest), (byte) =>
						byte.toString(16).padStart(2, "0"),
					).join("");
					const raw = storage().getItem(key);
					if (!raw || raw.length > 16_384) return;
					const cached = envelopeSchema.safeParse(JSON.parse(raw));
					if (!cached.success || cached.data.credentialHash !== credentialHash)
						return;
					const data = cached.data.data;
					if (
						data.user.id !== data.session.userId ||
						!data.session.organizationIds.includes(
							data.session.activeOrganizationId,
						)
					)
						return;
					snapshot = data as SessionData;
					lastEncoded = JSON.stringify(cached.data);
					notify();
				} catch {
					// Missing/corrupt storage must never delay or prevent normal sign-in.
				}
			})();
			return ready;
		},
		async remember(data: SessionData): Promise<void> {
			const version = generation;
			await ready;
			if (
				!enabled ||
				!credentialHash ||
				version !== generation ||
				data.session.token !== credential
			)
				return;
			const parsed = cachedSessionSchema.safeParse({
				user: { ...data.user, image: null },
				session: { ...data.session, token: "", ipAddress: "", userAgent: "" },
			});
			if (
				!parsed.success ||
				parsed.data.user.id !== parsed.data.session.userId ||
				!parsed.data.session.organizationIds.includes(
					parsed.data.session.activeOrganizationId,
				)
			)
				return;
			const encoded = JSON.stringify({ credentialHash, data: parsed.data });
			if (encoded.length > 16_384 || encoded === lastEncoded) return;
			lastEncoded = encoded;
			snapshot = parsed.data as SessionData;
			try {
				storage().setItem(key, encoded);
			} catch {
				/* Keep this launch's in-memory fallback. */
			}
			notify();
		},
	};
}
