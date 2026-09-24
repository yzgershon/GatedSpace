/** Report configuration, never credentials. Placeholder OAuth apps cannot sign in. */
export function configuredAuthProviders(values: {
	GH_CLIENT_ID?: string;
	GH_CLIENT_SECRET?: string;
	GOOGLE_CLIENT_ID?: string;
	GOOGLE_CLIENT_SECRET?: string;
}) {
	const usable = (value?: string) =>
		!!value?.trim() &&
		!/(replace|change.?me|placeholder|example|dummy|fake|mock|your[-_ ]|configure|oauth.*id)/i.test(
			value,
		) &&
		!value.includes("${");
	return {
		github: usable(values.GH_CLIENT_ID) && usable(values.GH_CLIENT_SECRET),
		google:
			usable(values.GOOGLE_CLIENT_ID) &&
			usable(values.GOOGLE_CLIENT_SECRET) &&
			!!values.GOOGLE_CLIENT_ID?.endsWith(".apps.googleusercontent.com"),
	};
}
