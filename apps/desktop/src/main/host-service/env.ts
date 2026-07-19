import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	server: {
		AUTH_TOKEN: z.string().min(1),
		SUPERSET_API_URL: z.string().url(),
		HOST_DB_PATH: z.string().min(1),
		HOST_MIGRATIONS_FOLDER: z.string().min(1),
		HOST_SERVICE_SECRET: z.string().min(1),
		HOST_SERVICE_PORT: z.coerce.number().int().positive(),
		ORGANIZATION_ID: z.string().min(1),
		DESKTOP_VITE_PORT: z.coerce.number().int().positive(),
		RELAY_URL: z.string().url().optional(),
		// "1" = local-only mode: every cloud API call is stubbed out with
		// CloudDisabledError and cloud mirroring is skipped (see
		// packages/host-service api/index.ts). Set by the coordinator when the
		// desktop app runs without an account.
		SUPERSET_LOCAL_ONLY: z.string().optional(),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
