import "server-only";

export type IntegrationProvider = "linear" | "github" | "slack";

const PROVIDER_FIELDS: Record<IntegrationProvider, string[]> = {
	linear: ["LINEAR_CLIENT_ID", "LINEAR_CLIENT_SECRET", "LINEAR_WEBHOOK_SECRET"],
	github: [
		"GH_APP_ID",
		"GH_APP_SLUG",
		"GH_APP_PRIVATE_KEY",
		"GH_WEBHOOK_SECRET",
	],
	slack: ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "SLACK_SIGNING_SECRET"],
};

const COMMON_FIELDS = [
	"INTEGRATIONS_PUBLIC_API_URL",
	"QSTASH_TOKEN",
	"QSTASH_CURRENT_SIGNING_KEY",
	"QSTASH_NEXT_SIGNING_KEY",
];

function isPlaceholder(value: string | undefined): boolean {
	if (!value?.trim()) return true;
	return /^(fake-|sig_fake|0+$|gatedspace-local$)/i.test(value.trim());
}

function isHttpsUrl(value: string): boolean {
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
}

export function getIntegrationConfigurationMessage(
	provider: IntegrationProvider,
): string | null {
	const missing = [...PROVIDER_FIELDS[provider], ...COMMON_FIELDS].filter(
		(name) => isPlaceholder(process.env[name]),
	);

	const publicApiUrl = process.env.INTEGRATIONS_PUBLIC_API_URL;
	if (
		publicApiUrl &&
		!isPlaceholder(publicApiUrl) &&
		!isHttpsUrl(publicApiUrl)
	) {
		missing.push("INTEGRATIONS_PUBLIC_API_URL (must use HTTPS)");
	}

	if (missing.length === 0) return null;
	return `Finish the local integration setup first. Missing: ${missing.join(", ")}.`;
}
