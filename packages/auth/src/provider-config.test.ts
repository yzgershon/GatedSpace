import { expect, test } from "bun:test";
import { configuredAuthProviders } from "./provider-config";

test("missing and placeholder OAuth applications are unavailable", () => {
	expect(configuredAuthProviders({})).toEqual({ google: false, github: false });
	expect(
		configuredAuthProviders({
			GH_CLIENT_ID: "configure-github-oauth-id",
			GH_CLIENT_SECRET: "placeholder",
			GOOGLE_CLIENT_ID: "your-google-client-id",
			GOOGLE_CLIENT_SECRET: "placeholder",
		}),
	).toEqual({ google: false, github: false });
});
test("reports configured providers without exposing their credentials", () => {
	expect(
		configuredAuthProviders({
			GH_CLIENT_ID: "Iv1.a1b2c3d4",
			GH_CLIENT_SECRET: "private-test-value",
			GOOGLE_CLIENT_ID: "123456-abcdef.apps.googleusercontent.com",
			GOOGLE_CLIENT_SECRET: "private-test-value",
		}),
	).toEqual({ google: true, github: true });
});
