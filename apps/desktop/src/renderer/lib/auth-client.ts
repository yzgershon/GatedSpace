import { apiKeyClient } from "@better-auth/api-key/client";
import { stripeClient } from "@better-auth/stripe/client";
import type { auth } from "@superset/auth/server";
import {
	customSessionClient,
	jwtClient,
	organizationClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { env } from "renderer/env.renderer";
import {
	isLocalMode,
	LOCAL_ORG_ID,
	LOCAL_USER_ID,
} from "renderer/lib/local-mode";

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
	authToken = token;
}

export function getAuthToken(): string | null {
	return authToken;
}

let jwt: string | null = null;

export function setJwt(token: string | null) {
	jwt = token;
}

export function getJwt(): string | null {
	return jwt;
}

/**
 * Better Auth client for Electron desktop app.
 *
 * Bearer authentication configured via onRequest hook.
 * Server has bearer() plugin enabled to accept bearer tokens.
 */
const realAuthClient = createAuthClient({
	baseURL: env.NEXT_PUBLIC_API_URL,
	plugins: [
		organizationClient({
			teams: { enabled: true },
			schema: {
				team: {
					additionalFields: {
						slug: { type: "string", input: true, required: true },
					},
				},
			},
		}),
		customSessionClient<typeof auth>(),
		stripeClient({ subscription: true }),
		apiKeyClient(),
		jwtClient(),
	],
	fetchOptions: {
		credentials: "include",
		onRequest: async (context) => {
			const token = getAuthToken();
			if (token) {
				context.headers.set("Authorization", `Bearer ${token}`);
			}
		},
		onResponse: async (context) => {
			const token = context.response.headers.get("set-auth-jwt");
			if (token) {
				setJwt(token);
			}
		},
	},
});

type SessionData = (typeof realAuthClient)["$Infer"]["Session"];

/**
 * Static session used in local-only mode: fixed local user/org ids, onboarded
 * (skips onboarding flow), created "now" (lands in the v2-only cohort), and
 * plan "pro" so nothing paywalls a local install. The ~50 downstream
 * `useSession()` call sites work against this unchanged.
 */
function buildLocalSession(): SessionData {
	const now = new Date();
	const tenYears = new Date(now.getTime() + 10 * 365 * 24 * 60 * 60 * 1000);
	return {
		user: {
			id: LOCAL_USER_ID,
			email: "local@gatedspace.local",
			name: "Local",
			emailVerified: true,
			image: null,
			createdAt: now,
			updatedAt: now,
			onboardedAt: now,
		},
		session: {
			id: "local-session",
			token: "local-only",
			userId: LOCAL_USER_ID,
			expiresAt: tenYears,
			createdAt: now,
			updatedAt: now,
			ipAddress: "",
			userAgent: "",
			activeOrganizationId: LOCAL_ORG_ID,
			organizationIds: [LOCAL_ORG_ID],
			role: "owner",
			plan: "pro",
		},
	} as unknown as SessionData;
}

function buildLocalAuthClient(): typeof realAuthClient {
	const localSession = buildLocalSession();

	const useLocalSession = () => ({
		data: localSession,
		isPending: false,
		isRefetching: false,
		error: null,
		refetch: async () => {},
	});

	const resolvedNull = async () => ({ data: null, error: null });

	// Only the members the app actually calls in local mode are overridden;
	// everything else falls through to the real client (and would fail against
	// the network, which is why cloud-only surfaces are hidden in local mode).
	return {
		...realAuthClient,
		useSession: useLocalSession as unknown as typeof realAuthClient.useSession,
		token: resolvedNull as unknown as typeof realAuthClient.token,
		signOut: resolvedNull as unknown as typeof realAuthClient.signOut,
		organization: {
			...realAuthClient.organization,
			setActive:
				resolvedNull as unknown as typeof realAuthClient.organization.setActive,
		},
	};
}

export const authClient = isLocalMode() ? buildLocalAuthClient() : realAuthClient;
