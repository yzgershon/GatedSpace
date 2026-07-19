export interface InvitationEmailConfiguration {
	resendApiKey: string | undefined;
	from: string | undefined;
	publicWebUrl: string | undefined;
}

export interface InvitationEmailConfigurationProblem {
	message: string;
	missing: string[];
}

function isRealResendApiKey(value: string | undefined): boolean {
	if (!value?.trim()) return false;
	return !/^re_(fake|test|placeholder)/i.test(value.trim());
}

function isPublicHttpsUrl(value: string | undefined): boolean {
	if (!value?.trim()) return false;
	try {
		const url = new URL(value);
		const hostname = url.hostname.toLowerCase();
		return (
			url.protocol === "https:" &&
			hostname !== "localhost" &&
			hostname !== "127.0.0.1" &&
			hostname !== "::1" &&
			!hostname.endsWith(".local")
		);
	} catch {
		return false;
	}
}

export function getInvitationEmailConfigurationProblem(
	configuration: InvitationEmailConfiguration,
): InvitationEmailConfigurationProblem | null {
	const missing: string[] = [];

	if (!isRealResendApiKey(configuration.resendApiKey)) {
		missing.push("a real RESEND_API_KEY");
	}
	if (!configuration.from?.trim()) {
		missing.push("INVITATION_EMAIL_FROM on a verified sending domain");
	}
	if (!isPublicHttpsUrl(configuration.publicWebUrl)) {
		missing.push("a public HTTPS INVITATION_PUBLIC_WEB_URL");
	}

	if (missing.length === 0) return null;
	return {
		missing,
		message: `Invitation email is not configured. Add ${missing.join(", ")}. Localhost invitation links cannot be opened by another person.`,
	};
}
