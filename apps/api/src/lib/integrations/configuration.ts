import { env } from "@/env";

export type IntegrationProvider = "linear" | "github" | "slack";

const PLACEHOLDER_PATTERNS = [
	/^fake-/i,
	/^sig_fake/i,
	/^0+$/,
	/^gatedspace-local$/i,
];

function isConfigured(value: string | undefined): boolean {
	if (!value?.trim()) return false;
	return !PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value.trim()));
}

function isHttpsUrl(value: string): boolean {
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
}

const PROVIDER_FIELDS: Record<
	IntegrationProvider,
	Array<[name: string, value: string | undefined]>
> = {
	linear: [
		["LINEAR_CLIENT_ID", env.LINEAR_CLIENT_ID],
		["LINEAR_CLIENT_SECRET", env.LINEAR_CLIENT_SECRET],
		["LINEAR_WEBHOOK_SECRET", env.LINEAR_WEBHOOK_SECRET],
	],
	github: [
		["GH_APP_ID", env.GH_APP_ID],
		["GH_APP_SLUG", env.GH_APP_SLUG],
		["GH_APP_PRIVATE_KEY", env.GH_APP_PRIVATE_KEY],
		["GH_WEBHOOK_SECRET", env.GH_WEBHOOK_SECRET],
	],
	slack: [
		["SLACK_CLIENT_ID", env.SLACK_CLIENT_ID],
		["SLACK_CLIENT_SECRET", env.SLACK_CLIENT_SECRET],
		["SLACK_SIGNING_SECRET", env.SLACK_SIGNING_SECRET],
	],
};

export function getIntegrationConfigurationProblem(
	provider: IntegrationProvider,
): { missing: string[]; message: string } | null {
	const missing = PROVIDER_FIELDS[provider]
		.filter(([, value]) => !isConfigured(value))
		.map(([name]) => name);

	for (const [name, value] of [
		["QSTASH_TOKEN", env.QSTASH_TOKEN],
		["QSTASH_CURRENT_SIGNING_KEY", env.QSTASH_CURRENT_SIGNING_KEY],
		["QSTASH_NEXT_SIGNING_KEY", env.QSTASH_NEXT_SIGNING_KEY],
	] as const) {
		if (!isConfigured(value)) missing.push(name);
	}

	if (!env.INTEGRATIONS_PUBLIC_API_URL) {
		missing.push("INTEGRATIONS_PUBLIC_API_URL");
	} else if (!isHttpsUrl(env.INTEGRATIONS_PUBLIC_API_URL)) {
		missing.push("INTEGRATIONS_PUBLIC_API_URL (must use HTTPS)");
	}

	if (missing.length === 0) return null;

	return {
		missing,
		message: `${provider} integration is not configured. Add real values for: ${missing.join(", ")}`,
	};
}

export function integrationConfigurationResponse(
	provider: IntegrationProvider,
): Response | null {
	const problem = getIntegrationConfigurationProblem(provider);
	if (!problem) return null;
	return Response.json(
		{
			error: "Integration not configured",
			provider,
			message: problem.message,
			missing: problem.missing,
		},
		{ status: 503 },
	);
}
