import { describe, expect, test } from "bun:test";
import { getInvitationEmailConfigurationProblem } from "./invitation-email-configuration";

describe("invitation email configuration", () => {
	test("rejects the local fake-email configuration", () => {
		const problem = getInvitationEmailConfigurationProblem({
			resendApiKey: "re_fake_local_dev",
			from: undefined,
			publicWebUrl: "http://localhost:3018",
		});

		expect(problem?.missing).toEqual([
			"a real RESEND_API_KEY",
			"INVITATION_EMAIL_FROM on a verified sending domain",
			"a public HTTPS INVITATION_PUBLIC_WEB_URL",
		]);
	});

	test("rejects malformed and loopback web URLs", () => {
		for (const publicWebUrl of [
			"not-a-url",
			"https://localhost:3018",
			"https://127.0.0.1:3018",
		]) {
			const problem = getInvitationEmailConfigurationProblem({
				resendApiKey: "re_live_example",
				from: "GatedSpace <invites@gatedspace.example>",
				publicWebUrl,
			});
			expect(problem?.missing).toContain(
				"a public HTTPS INVITATION_PUBLIC_WEB_URL",
			);
		}
	});

	test("accepts a configured public delivery path", () => {
		expect(
			getInvitationEmailConfigurationProblem({
				resendApiKey: "re_live_example",
				from: "GatedSpace <invites@gatedspace.dev>",
				publicWebUrl: "https://app.gatedspace.dev",
			}),
		).toBeNull();
	});
});
