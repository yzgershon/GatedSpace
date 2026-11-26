import type { BetterAuthOptions } from "better-auth";

export const sessionOptions = {
	expiresIn: 60 * 60 * 24 * 30,
	updateAge: 60 * 60 * 24,
	storeSessionInDatabase: true,
	cookieCache: {
		// Inline profile images can turn the session cache into hundreds of KB
		// of Set-Cookie headers. Chromium rejects the entire authentication response.
		// Keep profiles in the response body and validate sessions against the DB.
		enabled: false,
	},
} satisfies NonNullable<BetterAuthOptions["session"]>;
