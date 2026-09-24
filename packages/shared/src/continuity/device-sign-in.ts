import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { type HttpFetch, type startDeviceSignIn, syncOrigin } from "./client";
import { SYNC_CLIENT_ID } from "./protocol";

export type DeviceSignIn = Awaited<ReturnType<typeof startDeviceSignIn>>;
interface PollOptions {
	signal?: AbortSignal;
	fetcher?: HttpFetch;
	now?: () => number;
	wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}
const tokenSchema = z.object({
	access_token: z.string().min(16).max(4096),
	token_type: z.literal("Bearer"),
	expires_in: z
		.number()
		.int()
		.positive()
		.max(366 * 24 * 60 * 60),
});

/** Pending responses never count as permission or a successful login. */
export async function waitForDeviceSignIn(
	originInput: string,
	request: DeviceSignIn,
	options: PollOptions = {},
) {
	const origin = syncOrigin(originInput);
	const now = options.now ?? Date.now;
	const fetcher = options.fetcher ?? fetch;
	const wait =
		options.wait ?? ((ms, signal) => sleep(ms, undefined, { signal }));
	const deadline = now() + request.expires_in * 1000;
	let interval = request.interval * 1000;
	while (now() < deadline) {
		options.signal?.throwIfAborted();
		await wait(Math.min(interval, deadline - now()), options.signal);
		options.signal?.throwIfAborted();
		if (now() >= deadline) break;
		const timeout = AbortSignal.timeout(Math.min(15_000, deadline - now()));
		const response = await fetcher(`${origin}/api/auth/device/token`, {
			method: "POST",
			redirect: "error",
			signal: options.signal
				? AbortSignal.any([options.signal, timeout])
				: timeout,
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				client_id: SYNC_CLIENT_ID,
				device_code: request.device_code,
				grant_type: "urn:ietf:params:oauth:grant-type:device_code",
			}),
		});
		if (response.status === 429) {
			await response.body?.cancel();
			interval = Math.min(60_000, interval + 5000);
			continue;
		}
		const data: unknown = await response.json();
		if (response.ok) {
			const value = tokenSchema.parse(data);
			return {
				token: value.access_token,
				expiresAt: now() + value.expires_in * 1000,
			};
		}
		const problem = z.object({ error: z.string() }).safeParse(data);
		if (problem.success && problem.data.error === "authorization_pending")
			continue;
		if (problem.success && problem.data.error === "slow_down") {
			interval = Math.min(60_000, interval + 5000);
			continue;
		}
		if (problem.success && problem.data.error === "access_denied")
			throw new Error(
				"Connection was declined. This computer was not connected.",
			);
		if (problem.success && problem.data.error === "expired_token") break;
		throw new Error(
			"Could not complete sign-in. Start a new connection request.",
		);
	}
	throw new Error(
		"The connection code expired. Start a new connection request.",
	);
}
