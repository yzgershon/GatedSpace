import { z } from "zod";

function configuredCredential(value: string | undefined): value is string {
	return (
		!!value?.trim() &&
		!/^(placeholder|your[-_ ]|replace|example|changeme)/i.test(value.trim())
	);
}
export function providerAvailability(env = process.env) {
	return {
		google:
			configuredCredential(env.GOOGLE_CLIENT_ID) &&
			configuredCredential(env.GOOGLE_CLIENT_SECRET),
		github:
			configuredCredential(env.GITHUB_CLIENT_ID) &&
			configuredCredential(env.GITHUB_CLIENT_SECRET),
	};
}

export function serviceOrigin(value: string): string {
	const url = new URL(value);
	if (
		url.username ||
		url.password ||
		url.pathname !== "/" ||
		url.search ||
		url.hash
	)
		throw new Error("SYNC_ORIGIN must be an origin.");
	if (
		url.protocol !== "https:" &&
		!(
			process.env.NODE_ENV !== "production" &&
			url.protocol === "http:" &&
			["127.0.0.1", "localhost"].includes(url.hostname)
		)
	)
		throw new Error("The sync service requires HTTPS.");
	return url.origin;
}
export function configuration() {
	const values = z
		.object({
			SYNC_ORIGIN: z.string().transform(serviceOrigin),
			DATABASE_URL: z.string().startsWith("postgres"),
			BETTER_AUTH_SECRET: z.string().min(32),
			SYNC_ALLOWED_EMAILS: z.string().min(3),
			BLOB_READ_WRITE_TOKEN: z.string().min(20),
			GOOGLE_CLIENT_ID: z.string().optional(),
			GOOGLE_CLIENT_SECRET: z.string().optional(),
			GITHUB_CLIENT_ID: z.string().optional(),
			GITHUB_CLIENT_SECRET: z.string().optional(),
		})
		.parse(process.env);
	const allowedEmails = values.SYNC_ALLOWED_EMAILS.split(",").map((email) =>
		z.email().parse(email.trim().toLowerCase()),
	);
	return { ...values, allowedEmails };
}
