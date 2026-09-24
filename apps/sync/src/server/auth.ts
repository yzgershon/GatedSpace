import { Pool } from "@neondatabase/serverless";
import * as schema from "@superset/db/schema/continuity";
import { SYNC_CLIENT_ID } from "@superset/shared/continuity";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { betterAuth } from "better-auth/minimal";
import { bearer, deviceAuthorization } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/neon-serverless";
import { configuration, providerAvailability } from "./config";

function createServices() {
	const config = configuration();
	const providers = providerAvailability();
	const db = drizzle(
		new Pool({
			connectionString: config.DATABASE_URL,
			connectionTimeoutMillis: 8000,
			statement_timeout: 10000,
		}),
		{
			schema,
		},
	);
	const socialProviders = {
		...(providers.google &&
		config.GOOGLE_CLIENT_ID &&
		config.GOOGLE_CLIENT_SECRET
			? {
					google: {
						clientId: config.GOOGLE_CLIENT_ID,
						clientSecret: config.GOOGLE_CLIENT_SECRET,
					},
				}
			: {}),
		...(providers.github &&
		config.GITHUB_CLIENT_ID &&
		config.GITHUB_CLIENT_SECRET
			? {
					github: {
						clientId: config.GITHUB_CLIENT_ID,
						clientSecret: config.GITHUB_CLIENT_SECRET,
					},
				}
			: {}),
	};
	const auth = betterAuth({
		appName: "GatedSpace Sync",
		baseURL: config.SYNC_ORIGIN,
		secret: config.BETTER_AUTH_SECRET,
		database: drizzleAdapter(db, { provider: "pg", schema }),
		socialProviders,
		trustedOrigins: [config.SYNC_ORIGIN],
		account: {
			accountLinking: {
				enabled: true,
				trustedProviders: [],
				requireLocalEmailVerified: true,
				allowDifferentEmails: false,
			},
			encryptOAuthTokens: true,
		},
		session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
		rateLimit: { enabled: true, storage: "database", window: 60, max: 100 },
		plugins: [
			bearer(),
			deviceAuthorization({
				verificationUri: `${config.SYNC_ORIGIN}/device`,
				validateClient: (id) => id === SYNC_CLIENT_ID,
				expiresIn: "10m",
				interval: "5s",
			}),
		],
		databaseHooks: {
			user: {
				create: {
					before: async (value) => {
						if (
							!config.allowedEmails.includes(value.email.toLowerCase()) ||
							!value.emailVerified
						)
							throw new APIError("FORBIDDEN", {
								message:
									"This account is not enabled for this private GatedSpace service.",
							});
						return { data: value };
					},
				},
			},
		},
	});
	return { auth, db, config };
}
let instance: ReturnType<typeof createServices> | undefined;
export function services() {
	if (!instance) instance = createServices();
	return instance;
}
export type SyncDatabase = ReturnType<typeof services>["db"];
