import { expect, mock, test } from "bun:test";

mock.module("renderer/env.renderer", () => ({
	env: {
		NEXT_PUBLIC_LOCAL_ONLY: "1",
		NEXT_PUBLIC_API_URL: "http://127.0.0.1:1",
	},
}));
const { authClient } = await import("./auth-client");
const { LOCAL_ORG_ID, LOCAL_USER_ID } = await import("./local-mode");

test("local Settings receives a stable organization and its actual local owner", async () => {
	const session = authClient.useSession();
	const organization = authClient.useActiveOrganization();
	expect(organization.error).toBeNull();
	expect(organization.isPending).toBe(false);
	expect(organization.data?.id).toBe(LOCAL_ORG_ID);
	expect(session.data?.session.activeOrganizationId).toBe(
		organization.data?.id,
	);
	expect(
		organization.data?.members.find((m) => m.userId === LOCAL_USER_ID)?.role,
	).toBe("owner");
	expect(organization.data?.members[0]?.user.id).toBe(session.data?.user.id);
	await organization.refetch();
	expect(authClient.useActiveOrganization().data).toBe(organization.data);
});

test("local client preserves dynamically resolved Better Auth APIs", () => {
	// These methods are supplied by Better Auth's real Proxy, not own properties.
	expect(typeof authClient.useListOrganizations).toBe("function");
	expect(typeof authClient.organization.checkSlug).toBe("function");
	expect(typeof authClient.apiKey.delete).toBe("function");
	expect(typeof authClient.subscription.upgrade).toBe("function");
});

test("local lifecycle calls remain local and do not need a cloud server", async () => {
	for (const result of [
		await authClient.organization.setActive({ organizationId: LOCAL_ORG_ID }),
		await authClient.token(),
		await authClient.signOut(),
	]) {
		expect(result.data).toBeNull();
		expect(result.error).toBeNull();
	}
});
