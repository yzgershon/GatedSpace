import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { checkpointSchema } from "@superset/shared/continuity";
import { prepareCheckpoint } from "@superset/shared/continuity/client";
import { digest } from "@superset/shared/continuity/crypto";
import { z } from "zod";
import type { SyncConnection } from "./connection";

import { SyncOutbox } from "./outbox";
import { collectProject, restoreProject } from "./project-files";
import type { SyncVault } from "./vault";

const dependencies = {
	exportSession: async (
		...args: Parameters<typeof import("./native-sessions").exportNativeSession>
	) => (await import("./native-sessions")).exportNativeSession(...args),
	importSession: async (
		...args: Parameters<typeof import("./native-sessions").importNativeSession>
	) => (await import("./native-sessions")).importNativeSession(...args),
	sessions: async () =>
		(await import("./native-sessions")).transferableSessions(),
	isBusy: async (provider: "codex" | "claude", id: string) =>
		(await import("./native-sessions")).isNativeSessionBusy(provider, id),
	collect: collectProject,
	restore: restoreProject,
	stat,
};
type RemoteSummary = {
	id: string;
	revision: number;
	updatedAt: string;
	provider: "codex" | "claude";
	title: string;
	projectName: string;
	fileCount: number;
};

const bindingSchema = z.object({
	streamId: z.uuid(),
	provider: z.enum(["codex", "claude"]),
	sessionId: z.uuid(),
	title: z.string(),
	project: z.string(),
	revision: z.number().int().nonnegative(),
	sourceStamp: z.string(),
	autoSync: z.boolean(),
	updatedAt: z.string(),
});
const bindingsSchema = z.array(bindingSchema);
type Binding = z.infer<typeof bindingSchema>;

export class SyncTransfers {
	private busy = false;
	private error: string | null = null;
	private lastResult: { sent: number; conflicts: string[] } | null = null;
	private remote = new Map<string, RemoteSummary>();
	private outbox: SyncOutbox;
	constructor(
		private connection: SyncConnection,
		private vault: SyncVault,
		private deps = dependencies,
	) {
		this.outbox = new SyncOutbox(join(vault.directory, "outbox"));
	}
	private filename() {
		return `bindings-${digest(this.connection.credentials().account.id)}.vault`;
	}
	private bindings() {
		return this.vault.readDocument(this.filename(), bindingsSchema, []);
	}
	private save(bindings: Binding[]) {
		this.vault.writeDocument(this.filename(), bindingsSchema.parse(bindings));
	}
	status() {
		const connected = this.connection.status().account?.connected;
		return {
			busy: this.busy,
			error: this.error,
			result: this.lastResult,
			bindings: connected ? this.bindings() : [],
			queued: connected ? this.outbox.list().length : 0,
		};
	}
	private async run<T>(operation: () => Promise<T>): Promise<T> {
		if (this.busy) throw new Error("A Sync transfer is already running.");
		this.busy = true;
		this.error = null;
		try {
			return await operation();
		} catch (error) {
			this.error =
				error instanceof Error
					? error.message
					: "Transfer failed. Your local work is unchanged.";
			throw error;
		} finally {
			this.busy = false;
		}
	}
	private async capture(
		provider: "codex" | "claude",
		sessionId: string,
		project: string,
	) {
		const data = this.connection.credentials();
		if (!data.account.recoveryKey)
			throw new Error(
				"Set up your recovery key before transferring conversations.",
			);
		const rows = this.bindings();
		const previous = rows.find(
			(row) => row.provider === provider && row.sessionId === sessionId,
		);
		const streamId = previous?.streamId ?? randomUUID();
		const exported = await this.deps.exportSession(provider, sessionId);
		const payload = checkpointSchema.parse({
			version: 1,
			streamId,
			createdAt: new Date().toISOString(),
			project: await this.deps.collect(project),
			session: exported.session,
		});
		await exported.verify();
		const current = this.connection.credentials();
		if (
			data.account.id !== current.account.id ||
			data.account.token !== current.account.token
		)
			throw new Error(
				"The account connection changed. Retry saving the checkpoint.",
			);
		const binding: Binding = {
			streamId,
			provider,
			sessionId,
			title: exported.session.title,
			project,
			revision: previous?.revision ?? 0,
			sourceStamp: exported.sourceStamp,
			autoSync: previous?.autoSync ?? true,
			updatedAt: payload.createdAt,
		};
		// Persist the binding first with a retry marker. A crash before enqueue is
		// recoverable, and a crash after enqueue still has a known local owner.
		if (this.outbox.list().some((row) => row.streamId === streamId))
			throw new Error(
				"A checkpoint is already queued. Retry the transfer first.",
			);
		this.save([
			...rows.filter((row) => row.streamId !== streamId),
			{ ...binding, sourceStamp: "" },
		]);
		this.outbox.enqueue(
			prepareCheckpoint(payload, data.account.recoveryKey, data.account.id),
			data.account.id,
			data.deviceId,
			previous?.revision ?? 0,
		);
		this.save([...rows.filter((row) => row.streamId !== streamId), binding]);
	}
	private async flush() {
		const account = this.connection.credentials().account;
		let failure: unknown;
		try {
			if (this.outbox.list().length)
				this.lastResult = await this.outbox.drain(
					this.connection.client(),
					account.id,
				);
		} catch (error) {
			failure = error;
		}
		{
			// Even when a later stream fails, persist receipts for earlier successes.
			const receipts = this.outbox
				.receipts()
				.filter((row) => row.ownerId === account.id);
			if (receipts.length) {
				if (this.connection.credentials().account.id !== account.id)
					throw new Error(
						"The Sync account changed. Transfer receipts have been preserved.",
					);
				this.save(
					this.bindings().map((binding) => {
						const receipt = receipts
							.filter((row) => row.streamId === binding.streamId)
							.sort((a, b) => b.revision - a.revision)[0];
						return receipt
							? {
									...binding,
									revision: Math.max(binding.revision, receipt.revision),
								}
							: binding;
					}),
				);
				this.outbox.clearReceipts(account.id);
			}
		}
		if (failure) throw failure;
		return this.lastResult ?? { sent: 0, conflicts: [] };
	}

	send(provider: "codex" | "claude", sessionId: string, project: string) {
		return this.run(async () => {
			await this.capture(provider, sessionId, project);
			return this.flush();
		});
	}
	retry() {
		return this.run(() => this.flush());
	}
	syncNow(streamId: string) {
		return this.run(async () => {
			await this.flush();
			if (this.outbox.list().some((row) => row.streamId === streamId))
				return this.lastResult ?? { sent: 0, conflicts: [streamId] };
			const binding = this.bindings().find((row) => row.streamId === streamId);
			if (!binding) throw new Error("Select a conversation and project first.");
			await this.capture(binding.provider, binding.sessionId, binding.project);
			return this.flush();
		});
	}
	available() {
		return this.run(async () => {
			const data = this.connection.credentials();
			if (!data.account.recoveryKey)
				throw new Error("Enter your recovery key to see synced conversations.");
			const client = this.connection.client();
			const result: RemoteSummary[] = [];
			for (const head of await client.streams()) {
				if (!head.checkpointId) continue;
				const cacheKey = `${data.account.id}:${head.id}`;
				let cached = this.remote.get(cacheKey);
				if (!cached || cached.revision !== head.revision) {
					const { payload } = await client.download(
						head.checkpointId,
						head.id,
						data.account.id,
						data.account.recoveryKey,
					);
					// Keep only the small summary. Do not retain whole decrypted projects in memory.
					cached = {
						id: head.id,
						revision: head.revision,
						updatedAt: head.updatedAt,
						provider: payload.session.provider,
						title: payload.session.title,
						projectName: payload.project.name,
						fileCount: payload.project.files.length,
					};
					this.remote.set(cacheKey, cached);
				}
				result.push(cached);
			}
			return result;
		});
	}

	restore(streamId: string, parent: string, folderName: string) {
		return this.run(async () => {
			const data = this.connection.credentials();
			if (!data.account.recoveryKey)
				throw new Error("Enter your recovery key first.");
			const client = this.connection.client();
			const head = (await client.streams()).find((row) => row.id === streamId);
			if (!head?.checkpointId)
				throw new Error("That synced conversation is no longer available.");
			const snapshot = await client.download(
				head.checkpointId,
				streamId,
				data.account.id,
				data.account.recoveryKey,
			);
			const project = await this.deps.restore(
				parent,
				folderName,
				snapshot.payload.project,
			);
			const native = await this.deps.importSession(
				snapshot.payload.session,
				project,
			);
			const local = (await this.deps.sessions()).find(
				(row) =>
					row.provider === native.provider &&
					row.sessionId === native.sessionId,
			);
			const metadata = local ? await this.deps.stat(local.filePath) : null;
			this.outbox.hold(streamId, data.account.id);
			this.save([
				...this.bindings().filter((row) => row.streamId !== streamId),
				{
					streamId,
					provider: native.provider,
					sessionId: native.sessionId,
					title: native.title,
					project,
					revision: snapshot.revision,
					sourceStamp: metadata ? `${metadata.mtimeMs}:${metadata.size}` : "",
					autoSync: true,
					updatedAt: new Date().toISOString(),
				},
			]);
			// Preserve the old ciphertext and local project when switching to a newer
			// remote version. It can be synced separately by selecting the old session.
			this.lastResult = null;
			return native;
		});
	}
	setAutomatic(streamId: string, enabled: boolean) {
		if (this.busy) throw new Error("Wait for the current transfer to finish.");
		this.save(
			this.bindings().map((row) =>
				row.streamId === streamId ? { ...row, autoSync: enabled } : row,
			),
		);
	}
	async tick() {
		if (this.busy) return;
		const account = this.connection.status().account;
		if (!account?.connected || !account.hasRecoveryKey) return;
		if (
			!this.bindings().some((row) => row.autoSync) &&
			!this.outbox.list().length &&
			!this.outbox.receipts().length
		)
			return;
		await this.run(async () => {
			await this.flush();
			const sessions = await this.deps.sessions();
			for (const binding of this.bindings().filter((row) => row.autoSync)) {
				if (this.outbox.list().some((row) => row.streamId === binding.streamId))
					continue;
				const session = sessions.find(
					(row) =>
						row.provider === binding.provider &&
						row.sessionId === binding.sessionId,
				);
				if (
					!session ||
					(await this.deps.isBusy(binding.provider, binding.sessionId))
				)
					continue;
				const stamp = await this.deps
					.stat(session.filePath)
					.then((file) => `${file.mtimeMs}:${file.size}`);
				if (stamp !== binding.sourceStamp)
					await this.capture(
						binding.provider,
						binding.sessionId,
						binding.project,
					);
			}
			await this.flush();
		});
	}
}
