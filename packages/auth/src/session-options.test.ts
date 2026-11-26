import { expect, test } from "bun:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { bearer } from "better-auth/plugins";
import { sessionOptions } from "./session-options";

test("large profile images cannot break sign-in or session recovery headers", async () => {
	const auth = betterAuth({
		baseURL: "http://localhost:3001",
		secret: "isolated-avatar-regression-test-secret-123456789",
		database: memoryAdapter({
			user: [],
			account: [],
			session: [],
			verification: [],
		}),
		emailAndPassword: { enabled: true },
		session: sessionOptions,
		plugins: [bearer()],
		logger: { disabled: true },
	});
	const email = "avatar-test@example.test";
	const password = "test-only-avatar-password-123";
	const signup = await auth.api.signUpEmail({
		body: { name: "Avatar test", email, password },
	});
	const avatar = `data:image/png;base64,${"A".repeat(310_000)}`;
	const context = await auth.$context;
	await context.internalAdapter.updateUser(signup.user.id, { image: avatar });
	const signedIn = await auth.api.signInEmail({
		body: { email, password },
		asResponse: true,
	});
	expect(signedIn.status).toBe(200);
	const { token } = await signedIn.clone().json();
	const restored = await auth.handler(
		new Request("http://localhost:3001/api/auth/get-session", {
			headers: { Authorization: `Bearer ${token}` },
		}),
	);
	expect(restored.status).toBe(200);
	const session = await restored.clone().json();
	expect(session.user.id).toBe(signup.user.id);
	expect(session.user.image).toBe(avatar);
	for (const response of [signedIn, restored]) {
		const bytes = [...response.headers].reduce(
			(size, [name, value]) => size + Buffer.byteLength(name + value),
			0,
		);
		expect(bytes).toBeLessThan(8_192);
		expect(
			response.headers
				.getSetCookie()
				.some((cookie) => cookie.includes("session_data")),
		).toBe(false);
	}
});
