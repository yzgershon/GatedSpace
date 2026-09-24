import { expect, test } from "bun:test";
import { waitForDeviceSignIn } from "./device-sign-in";

const request = {
	device_code: "synthetic-device-code-only",
	user_code: "ABCD1234",
	verification_uri: "https://sync.example.test/device",
	url: "https://sync.example.test/device?user_code=ABCD1234",
	expires_in: 600,
	interval: 5,
};

test("device sign-in waits for approval, slows polling and returns only an actual token", async () => {
	let time = 0,
		calls = 0;
	const waits: number[] = [];
	const replies = [
		Response.json({ error: "authorization_pending" }, { status: 400 }),
		Response.json({ error: "slow_down" }, { status: 400 }),
		Response.json({}, { status: 429 }),
		Response.json({
			access_token: "synthetic-access-token-only",
			token_type: "Bearer",
			expires_in: 3600,
		}),
	];
	const result = await waitForDeviceSignIn(
		"https://sync.example.test",
		request,
		{
			now: () => time,
			wait: async (ms) => {
				waits.push(ms);
				time += ms;
			},
			fetcher: async (url, init) => {
				expect(String(url)).toBe(
					"https://sync.example.test/api/auth/device/token",
				);
				expect(init?.redirect).toBe("error");
				expect(JSON.parse(String(init?.body)).client_id).toBe(
					"gatedspace-desktop",
				);
				calls++;
				const next = replies.shift();
				if (!next) throw new Error("Unexpected extra request");
				return next;
			},
		},
	);
	expect(calls).toBe(4);
	expect(waits).toEqual([5000, 5000, 10000, 15000]);
	expect(result.expiresAt).toBe(time + 3_600_000);
});

test("denied and expired requests never connect", async () => {
	for (const error of ["access_denied", "expired_token"]) {
		await expect(
			waitForDeviceSignIn("https://sync.example.test", request, {
				wait: async () => {},
				fetcher: async () => Response.json({ error }, { status: 400 }),
			}),
		).rejects.toThrow(error === "access_denied" ? "declined" : "expired");
	}
	let time = 0,
		calls = 0;
	await expect(
		waitForDeviceSignIn(
			"https://sync.example.test",
			{ ...request, expires_in: 10 },
			{
				now: () => time,
				wait: async (ms) => {
					time += ms;
				},
				fetcher: async () => {
					calls++;
					return Response.json(
						{ error: "authorization_pending" },
						{ status: 400 },
					);
				},
			},
		),
	).rejects.toThrow("expired");
	expect(calls).toBe(1);
});

test("cancelling a connection does not poll or accept a default choice", async () => {
	const controller = new AbortController();
	controller.abort();
	let calls = 0;
	await expect(
		waitForDeviceSignIn("https://sync.example.test", request, {
			signal: controller.signal,
			fetcher: async () => {
				calls++;
				return Response.json({});
			},
		}),
	).rejects.toThrow();
	expect(calls).toBe(0);
});
