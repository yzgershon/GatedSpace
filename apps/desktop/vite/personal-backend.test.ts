import { expect, test } from "bun:test";
import { applyPersonalBackend, PERSONAL_BACKEND } from "./personal-backend";

test("isolated personal builds get the local backend without a .env file", () => {
	const environment = { GATEDSPACE_PERSONAL: "1" };
	applyPersonalBackend(environment);
	expect(environment).toMatchObject(PERSONAL_BACKEND);
});

test("an inherited hosted API cannot redirect a personal installer", () => {
	const environment = {
		GATEDSPACE_PERSONAL: "1",
		NEXT_PUBLIC_API_URL: "https://api.superset.sh",
		NEXT_PUBLIC_ELECTRIC_URL: "https://wrong.example",
	};
	applyPersonalBackend(environment);
	expect(environment).toMatchObject(PERSONAL_BACKEND);
});

test("public and development endpoint configuration is preserved", () => {
	const environment = {
		NEXT_PUBLIC_API_URL: "https://api.example.com",
		NEXT_PUBLIC_LOCAL_ONLY: "1",
	};
	const before = { ...environment };
	applyPersonalBackend(environment);
	expect(environment).toEqual(before);
});

test("mixed personal and public identities fail before compilation", () => {
	for (const flag of ["NEXT_PUBLIC_LOCAL_ONLY", "NEXT_PUBLIC_RELEASE_BUILD"]) {
		expect(() =>
			applyPersonalBackend({ GATEDSPACE_PERSONAL: "1", [flag]: "1" }),
		).toThrow("Personal installers cannot use public/local-only build flags");
	}
});
