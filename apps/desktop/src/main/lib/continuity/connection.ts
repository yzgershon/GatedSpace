import { hostname } from "node:os";
import {
	ContinuityClient,
	startDeviceSignIn,
} from "@superset/shared/continuity/client";
import {
	newRecoveryKey,
	parseRecoveryKey,
} from "@superset/shared/continuity/crypto";
import { waitForDeviceSignIn } from "@superset/shared/continuity/device-sign-in";
import type { SyncVault, SyncVaultData } from "./vault";

const ORIGIN = "https://gatedspace-sync.vercel.app";
const dependencies = {
	start: startDeviceSignIn,
	wait: waitForDeviceSignIn,
	client: (token: string) => new ContinuityClient(ORIGIN, token),
};
export class SyncConnection {
	private pending: {
		controller: AbortController;
		code: string;
		url: string;
		expiresAt: number;
	} | null = null;
	private error: string | null = null;
	private generation = 0;
	constructor(
		private vault: SyncVault,
		private deps = dependencies,
	) {}
	status() {
		const data = this.vault.read();
		return {
			origin: ORIGIN,
			deviceName: hostname(),
			account: data.account
				? {
						email: data.account.email,
						connected: Boolean(
							data.account.token && (data.account.expiresAt ?? 0) > Date.now(),
						),
						hasRecoveryKey: Boolean(data.account.recoveryKey),
					}
				: null,
			pending: this.pending
				? {
						code: this.pending.code,
						url: this.pending.url,
						expiresAt: this.pending.expiresAt,
					}
				: null,
			error: this.error,
		};
	}
	async begin() {
		this.cancel();
		const generation = this.generation;
		// Confirm that OS protection works before creating a connection request.
		this.vault.write(this.vault.read());
		const request = await this.deps.start(ORIGIN);
		if (generation !== this.generation) return this.status();
		const controller = new AbortController();
		this.pending = {
			controller,
			code: request.user_code,
			url: request.url,
			expiresAt: Date.now() + request.expires_in * 1000,
		};
		void this.deps
			.wait(ORIGIN, request, { signal: controller.signal })
			.then(async (result) => {
				if (controller.signal.aborted || generation !== this.generation) return;
				const client = this.deps.client(result.token);
				const account = await client.account();
				const data = this.vault.read();
				if (data.account && data.account.id !== account.id)
					throw new Error(
						"This computer is paired with another Sync account. Its recovery key and queued work have been preserved.",
					);
				await client.register(data.deviceId, hostname().slice(0, 100));
				if (controller.signal.aborted || generation !== this.generation) return;
				const latest = this.vault.read();
				this.vault.write({
					...latest,
					account: {
						...account,
						...result,
						recoveryKey: latest.account?.recoveryKey,
					},
				});
			})
			.catch(() => {
				if (!controller.signal.aborted && generation === this.generation)
					this.error =
						"Connection did not finish. Your local work is safe. Try connecting again.";
			})
			.finally(() => {
				if (generation === this.generation) this.pending = null;
			});
		return this.status();
	}
	cancel() {
		this.generation++;
		this.pending?.controller.abort();
		this.pending = null;
		this.error = null;
	}
	credentials(): SyncVaultData & {
		account: NonNullable<SyncVaultData["account"]> & { token: string };
	} {
		const data = this.vault.read();
		if (!data.account?.token || (data.account.expiresAt ?? 0) <= Date.now())
			throw new Error("Connect this computer to GatedSpace Sync first.");
		return { ...data, account: { ...data.account, token: data.account.token } };
	}
	client() {
		return this.deps.client(this.credentials().account.token);
	}
	async setRecoveryKey(key?: string) {
		const generation = this.generation;
		const data = this.credentials();
		if (data.account.recoveryKey)
			throw new Error("A recovery key is already stored on this computer.");
		if (key) parseRecoveryKey(key).fill(0);
		const client = this.deps.client(data.account.token);
		const streams = (await client.streams()).filter(
			(stream) => stream.checkpointId,
		);
		if (!key && streams.length)
			throw new Error(
				"This account already has synced work. Enter its existing recovery key from your other PC.",
			);
		const recoveryKey = key ?? newRecoveryKey();
		for (const stream of streams.slice(0, 1)) {
			if (stream.checkpointId)
				await client.download(
					stream.checkpointId,
					stream.id,
					data.account.id,
					recoveryKey,
				);
		}
		// Do not restore an old token or resurrect a disconnected session after a slow request.
		const current = this.credentials();
		if (
			generation !== this.generation ||
			current.account.recoveryKey ||
			current.account.id !== data.account.id ||
			current.account.token !== data.account.token
		)
			throw new Error("The connection changed. Retry recovery-key setup.");
		this.vault.write({
			...current,
			account: { ...current.account, recoveryKey },
		});
		return this.status();
	}
	recoveryKey() {
		const key = this.vault.read().account?.recoveryKey;
		if (!key) throw new Error("Set up a recovery key first.");
		return key;
	}
	async disconnect() {
		this.cancel();
		const generation = this.generation;
		const data = this.vault.read();
		if (data.account?.token) {
			const response = await fetch(`${ORIGIN}/api/auth/sign-out`, {
				method: "POST",
				redirect: "error",
				signal: AbortSignal.timeout(15_000),
				headers: {
					Authorization: `Bearer ${data.account.token}`,
					"Content-Type": "application/json",
					Origin: ORIGIN,
				},
				body: "{}",
			});
			if (!response.ok)
				throw new Error(
					"Could not revoke this connection. Retry when the service is reachable.",
				);
		}
		if (data.account && generation === this.generation)
			this.vault.write({
				...data,
				account: { ...data.account, token: undefined, expiresAt: undefined },
			});
		return this.status();
	}
}
