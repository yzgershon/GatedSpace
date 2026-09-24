/** Opt-in integration check. Run only against a disposable branch, never main. */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { Pool } from "@neondatabase/serverless";
import * as schema from "@superset/db/schema/continuity";
import { MAX_ACCOUNT_BYTES, SYNC_CLIENT_ID } from "@superset/shared/continuity";
import { digest } from "@superset/shared/continuity/crypto";
import { createAuthEndpoint } from "better-auth/api";
import { handleOAuthUserInfo } from "better-auth/oauth2";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { services } from "../src/server/auth";
import { CheckpointStore } from "../src/server/store";

const [envFile, expectedHost, receiptFile] = process.argv.slice(2);
assert(
	envFile && expectedHost && receiptFile,
	"Pass protected env file, test host and receipt path",
);
const env = parseEnv(readFileSync(resolve(envFile), "utf8"));
assert(
	env.SYNC_TEST_BRANCH?.startsWith("br-"),
	"An explicit test branch is required",
);
assert(expectedHost.endsWith(".neon.tech"), "Expected Neon test host");
assert.equal(expectedHost, env.SYNC_TEST_HOST, "Explicit test host must match");
assert(env.SYNC_MAIN_HOST, "Main host is required as an exclusion guard");
assert.equal(new URL(env.DATABASE_URL_UNPOOLED ?? "").hostname, expectedHost);
assert.notEqual(
	expectedHost,
	env.SYNC_MAIN_HOST,
	"Never test against dedicated main",
);
writeFileSync(
	resolve(receiptFile),
	JSON.stringify({ passed: false, at: new Date().toISOString() }),
);
const runId = randomUUID();
const emails = [`a-${runId}@example.test`, `b-${runId}@example.test`] as const;
Object.assign(process.env, {
	DATABASE_URL: env.DATABASE_URL_UNPOOLED,
	SYNC_ORIGIN: "https://sync-db-test.invalid",
	SYNC_ALLOWED_EMAILS: emails.join(","),
	BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
	BLOB_READ_WRITE_TOKEN: "synthetic-test-token-not-used",
	GOOGLE_CLIENT_ID: "",
	GOOGLE_CLIENT_SECRET: "",
	GITHUB_CLIENT_ID: "",
	GITHUB_CLIENT_SECRET: "",
});
const pool = new Pool({
	connectionString: env.DATABASE_URL_UNPOOLED,
	connectionTimeoutMillis: 8000,
	statement_timeout: 10000,
});
const db = drizzle(pool, { schema });
const { auth, db: authDb } = services();
const ownerIds: string[] = [];
const checks: string[] = [];
let testDeviceCode: string | undefined;
try {
	const context = await auth.$context;
	for (const email of emails) {
		const owner = await context.internalAdapter.createUser({
			name: "Synthetic database verification",
			email,
			emailVerified: true,
		});
		ownerIds.push(owner.id);
	}
	await assert.rejects(
		context.internalAdapter.createUser({
			name: "Rejected verification",
			email: `denied-${runId}@example.test`,
			emailVerified: true,
		}),
	);
	await assert.rejects(
		context.internalAdapter.createUser({
			name: "Unverified",
			email: emails[0],
			emailVerified: false,
		}),
	);
	const [ownerA, ownerB] = ownerIds;
	assert(ownerA && ownerB);
	// Exercise the installed OAuth account-linking logic with the real adapter.
	// No provider network request or real user credentials are involved.
	const checkOAuth = (profile: Parameters<typeof handleOAuthUserInfo>[1]) =>
		createAuthEndpoint(
			"/synthetic-oauth-check",
			{ method: "POST" },
			(endpoint) => handleOAuthUserInfo(endpoint, profile),
		)({ context, headers: new Headers() });
	const oauthProfile = {
		id: `oauth-${runId}`,
		name: "Synthetic verified identity",
		email: emails[0],
		emailVerified: true,
	};
	for (const providerId of ["google", "github"]) {
		const linked = await checkOAuth({
			userInfo: oauthProfile,
			account: {
				providerId,
				accountId: oauthProfile.id,
				accessToken: "synthetic-oauth-token",
			},
		});
		assert.equal(linked.error, null);
		assert.equal(linked.data?.user.id, ownerA);
	}
	const linkedAccounts = await db
		.select()
		.from(schema.account)
		.where(eq(schema.account.userId, ownerA));
	assert.equal(linkedAccounts.length, 2);
	assert(
		linkedAccounts.every(
			(account) =>
				account.accessToken && account.accessToken !== "synthetic-oauth-token",
		),
	);
	const unverified = await checkOAuth({
		userInfo: {
			...oauthProfile,
			id: `unverified-${runId}`,
			emailVerified: false,
		},
		account: {
			providerId: "unverified-test",
			accountId: `unverified-${runId}`,
		},
	});
	assert.equal(unverified.error, "account not linked");
	checks.push(
		"Google/GitHub verified identities share one account; unverified linking is rejected and stored OAuth tokens are encrypted",
	);
	const session = await context.internalAdapter.createSession(ownerA);
	assert(session);
	const response = await auth.handler(
		new Request("https://sync-db-test.invalid/api/auth/get-session", {
			headers: {
				authorization: `Bearer ${session.token}`,
				"x-forwarded-for": "192.0.2.5",
			},
		}),
	);
	assert.equal(response.status, 200);
	assert.equal((await response.json()).user.id, ownerA);
	checks.push(
		"Real auth adapter creates users/sessions, reads bearer identity, rejects unapproved/unverified users",
	);
	const codeResponse = await auth.handler(
		new Request("https://sync-db-test.invalid/api/auth/device/code", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-forwarded-for": "192.0.2.5",
			},
			body: JSON.stringify({ client_id: SYNC_CLIENT_ID }),
		}),
	);
	assert.equal(codeResponse.status, 200);
	const code = await codeResponse.json();
	assert.equal(typeof code.device_code, "string");
	testDeviceCode = code.device_code;
	const poll = await auth.handler(
		new Request("https://sync-db-test.invalid/api/auth/device/token", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-forwarded-for": "192.0.2.5",
			},
			body: JSON.stringify({
				grant_type: "urn:ietf:params:oauth:grant-type:device_code",
				client_id: SYNC_CLIENT_ID,
				device_code: testDeviceCode,
			}),
		}),
	);
	assert.equal((await poll.json()).error, "authorization_pending");
	checks.push("Device codes persist and cannot issue a token before approval");
	const claimed = await auth.handler(
		new Request(
			`https://sync-db-test.invalid/api/auth/device?user_code=${encodeURIComponent(code.user_code)}`,
			{
				headers: {
					authorization: `Bearer ${session.token}`,
					"x-forwarded-for": "192.0.2.5",
				},
			},
		),
	);
	assert.equal(claimed.status, 200);
	const foreignSession = await context.internalAdapter.createSession(ownerB);
	assert(foreignSession);
	const approve = (token: string) =>
		auth.handler(
			new Request("https://sync-db-test.invalid/api/auth/device/approve", {
				method: "POST",
				headers: {
					authorization: `Bearer ${token}`,
					"content-type": "application/json",
					"x-forwarded-for": "192.0.2.5",
					origin: "https://sync-db-test.invalid",
				},
				body: JSON.stringify({ userCode: code.user_code }),
			}),
		);
	assert.equal((await approve(foreignSession.token)).status, 403);
	assert.equal((await approve(session.token)).status, 200);
	await new Promise((resolve) => setTimeout(resolve, 5200));
	const approvedPoll = await auth.handler(
		new Request("https://sync-db-test.invalid/api/auth/device/token", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-forwarded-for": "192.0.2.5",
			},
			body: JSON.stringify({
				grant_type: "urn:ietf:params:oauth:grant-type:device_code",
				client_id: SYNC_CLIENT_ID,
				device_code: testDeviceCode,
			}),
		}),
	);
	assert.equal(approvedPoll.status, 200);
	const tokenResult = await approvedPoll.json();
	assert.equal(typeof tokenResult.access_token, "string");
	const resumed = await auth.handler(
		new Request("https://sync-db-test.invalid/api/auth/get-session", {
			headers: {
				authorization: `Bearer ${tokenResult.access_token}`,
				"x-forwarded-for": "192.0.2.5",
			},
		}),
	);
	assert.equal((await resumed.json()).user.id, ownerA);
	checks.push(
		"Only the claiming account can approve a device; its issued token resolves to that account",
	);
	let now = new Date();
	const store = new CheckpointStore(db, () => now);
	const streamId = randomUUID();
	const deviceA = randomUUID();
	const deviceB = randomUUID();
	await store.register(ownerA, deviceA, "Test laptop");
	await store.register(ownerA, deviceB, "Test OMEN");
	await store.create(ownerA, streamId);
	await Promise.all(
		[
			store.register(ownerB, deviceA, "Foreign"),
			store.create(ownerB, streamId),
			store.acquire(ownerB, streamId, deviceA, 0),
		].map((attempt) => assert.rejects(attempt, { code: "not_found" })),
	);
	assert.deepEqual(await store.list(ownerB), []);
	checks.push(
		"Foreign accounts cannot read, register over or acquire another account's session",
	);
	const contenders = await Promise.allSettled([
		store.acquire(ownerA, streamId, deviceA, 0),
		store.acquire(ownerA, streamId, deviceB, 0),
	]);
	assert.equal(contenders.filter((r) => r.status === "fulfilled").length, 1);
	const winnerIndex = contenders.findIndex((r) => r.status === "fulfilled");
	const winner = contenders[winnerIndex];
	assert(winner?.status === "fulfilled");
	const loser = contenders[1 - winnerIndex];
	assert(loser?.status === "rejected");
	assert.equal(loser.reason.code, "session_in_use");
	const identity = {
		...winner.value,
		deviceId: winnerIndex === 0 ? deviceA : deviceB,
	};
	checks.push(
		"Concurrent devices yield exactly one lease owner under Postgres row locks",
	);
	const chunk = { id: digest(`synthetic encrypted chunk ${runId}`), bytes: 80 };
	await Promise.all([
		store.reserveObject(ownerA, chunk.id, chunk.bytes),
		store.reserveObject(ownerA, chunk.id, chunk.bytes),
	]);
	const [quota] = await db
		.select()
		.from(schema.quotas)
		.where(eq(schema.quotas.ownerId, ownerA));
	assert.equal(quota?.bytes, chunk.bytes);
	const input = {
		...identity,
		id: randomUUID(),
		baseRevision: 0,
		manifest: { version: 1 as const, chunks: [chunk] },
	};
	await assert.rejects(store.publish(ownerA, streamId, input), {
		code: "incomplete_checkpoint",
	});
	await store.markReady(ownerA, chunk.id);
	await assert.rejects(store.object(ownerB, chunk.id), { code: "not_found" });
	const commits = await Promise.allSettled([
		store.publish(ownerA, streamId, input),
		store.publish(ownerA, streamId, { ...input, id: randomUUID() }),
	]);
	assert.equal(commits.filter((r) => r.status === "fulfilled").length, 1);
	const published = commits.find((r) => r.status === "fulfilled");
	assert(published?.status === "fulfilled");
	const acceptedInput = { ...input, id: published.value.checkpointId };
	assert.equal(published.value.revision, 1);
	assert.deepEqual(
		await store.publish(ownerA, streamId, acceptedInput),
		published.value,
	);
	await assert.rejects(
		store.publish(ownerA, streamId, { ...acceptedInput, baseRevision: 1 }),
		{ code: "request_reused" },
	);
	await assert.rejects(store.checkpoint(ownerB, acceptedInput.id), {
		code: "not_found",
	});
	checks.push(
		"Chunk retries count quota once; incomplete and foreign checkpoints are rejected; concurrent publish commits once; retry is idempotent",
	);
	now = new Date(now.getTime() + 121000);
	await assert.rejects(store.lease(ownerA, streamId, identity, false), {
		code: "lease_lost",
	});
	const renewed = await store.acquire(ownerA, streamId, deviceB, 1);
	assert(renewed.fence > identity.fence);
	await assert.rejects(
		store.publish(ownerA, streamId, {
			...input,
			id: randomUUID(),
			baseRevision: 1,
		}),
		{ code: "lease_lost" },
	);
	await store.lease(ownerA, streamId, { ...renewed, deviceId: deviceB }, true);
	checks.push(
		"Expired/replaced writers cannot publish; a new device can safely continue and release",
	);
	await db
		.update(schema.quotas)
		.set({ bytes: MAX_ACCOUNT_BYTES - 50 })
		.where(eq(schema.quotas.ownerId, ownerA));
	const overQuota = await Promise.allSettled([
		store.reserveObject(ownerA, digest(`q1-${runId}`), 40),
		store.reserveObject(ownerA, digest(`q2-${runId}`), 40),
	]);
	assert.equal(overQuota.filter((r) => r.status === "fulfilled").length, 1);
	const denied = overQuota.find((r) => r.status === "rejected");
	assert(denied?.status === "rejected");
	assert.equal(denied.reason.code, "quota_exceeded");
	checks.push("Concurrent uploads cannot exceed account quota");
} finally {
	if (testDeviceCode)
		await db
			.delete(schema.deviceCode)
			.where(eq(schema.deviceCode.deviceCode, testDeviceCode));
	if (ownerIds.length)
		await db
			.delete(schema.user)
			.where(
				and(
					inArray(schema.user.id, ownerIds),
					inArray(schema.user.email, emails),
				),
			);
	await Promise.all([pool.end(), authDb.$client.end()]);
}

const migrationSha256 = createHash("sha256")
	.update(
		readFileSync(
			new URL("../drizzle/0000_initial_continuity.sql", import.meta.url),
		),
	)
	.digest("hex");
writeFileSync(
	resolve(receiptFile),
	JSON.stringify(
		{
			passed: true,
			at: new Date().toISOString(),
			host: expectedHost,
			branch: env.SYNC_TEST_BRANCH,
			migrationSha256,
			checks,
		},
		null,
		2,
	),
);
console.log(JSON.stringify({ passed: true, checks }));
