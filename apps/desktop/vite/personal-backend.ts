/** Public addresses only. Personal installers must not depend on an untracked .env. */
export const PERSONAL_BACKEND = {
	NEXT_PUBLIC_API_URL: "http://localhost:3001",
	NEXT_PUBLIC_WEB_URL: "http://localhost:3018",
	NEXT_PUBLIC_STREAMS_URL: "http://localhost:3007",
	NEXT_PUBLIC_ELECTRIC_URL: "http://localhost:3012",
} as const;

export function applyPersonalBackend(environment: NodeJS.ProcessEnv) {
	if (environment.GATEDSPACE_PERSONAL !== "1") return;
	if (
		environment.NEXT_PUBLIC_LOCAL_ONLY === "1" ||
		environment.NEXT_PUBLIC_RELEASE_BUILD === "1"
	) {
		throw new Error(
			"Personal installers cannot use public/local-only build flags",
		);
	}
	Object.assign(environment, PERSONAL_BACKEND);
}
