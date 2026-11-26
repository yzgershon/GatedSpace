import { randomUUID } from "node:crypto";
import type { UsageRecoveryState } from "../../../shared/usage-recovery";

interface Entry {
	state: UsageRecoveryState;
	timer?: ReturnType<typeof setTimeout>;
}

/** Main-process ownership keeps a scheduled continuation alive across tab switches.
 * Schedules are deliberately not persisted: quitting cancels the user's opt-in. */
export class UsageRecovery {
	private entries = new Map<string, Entry>();
	private attempts = new Map<string, Entry>();
	constructor(
		private callbacks: {
			changed: (key: string, state: UsageRecoveryState | null) => void;
			resume: (key: string) => Promise<void>;
			reset: (key: string) => Promise<number | null>;
		},
		private now = Date.now,
		private timers = { set: setTimeout, clear: clearTimeout },
	) {}

	get(key: string) {
		return this.entries.get(key)?.state ?? null;
	}

	isContinuing(key: string) {
		return this.attempts.has(key);
	}

	block(key: string, message: string, resetAt: number | null = null) {
		const existing = this.entries.get(key);
		const entry = existing ?? {
			state: {
				id: randomUUID(),
				message,
				resetAt,
				autoContinue: false,
				continuing: false,
			},
		};
		entry.state = {
			...entry.state,
			message,
			resetAt:
				resetAt === null
					? entry.state.resetAt
					: Math.max(resetAt, entry.state.resetAt ?? 0),
		};
		this.entries.set(key, entry);
		this.emit(key, entry);
		if (entry.state.autoContinue) this.schedule(key, entry);
		return entry.state;
	}

	async refresh(key: string) {
		const entry = this.entries.get(key);
		if (!entry) return null;
		const resetAt = await this.callbacks.reset(key);
		if (this.entries.get(key) !== entry) return this.get(key);
		if (resetAt !== null) {
			entry.state = {
				...entry.state,
				resetAt: Math.max(resetAt, entry.state.resetAt ?? 0),
			};
			this.emit(key, entry);
			if (entry.state.autoContinue) this.schedule(key, entry);
		}
		return entry.state;
	}

	async setAutoContinue(key: string, enabled: boolean) {
		const entry = this.entries.get(key);
		if (!entry)
			throw new Error("This session is no longer waiting for a usage reset.");
		if (entry.state.continuing)
			throw new Error("This session is already continuing.");
		// Cancel synchronously, including while a reset lookup is in flight.
		this.timers.clear(entry.timer);
		entry.state = { ...entry.state, autoContinue: enabled, error: undefined };
		this.emit(key, entry);
		if (!enabled) return entry.state;
		try {
			await this.refresh(key);
			if (this.entries.get(key) !== entry || !entry.state.autoContinue)
				return this.get(key);
			if (!entry.state.resetAt)
				throw new Error(
					"The account hasn't reported a reset time yet. Check again in a moment.",
				);
			this.schedule(key, entry);
		} catch (error) {
			if (this.entries.get(key) === entry && entry.state.autoContinue) {
				entry.state = {
					...entry.state,
					autoContinue: false,
					error: error instanceof Error ? error.message : String(error),
				};
				this.emit(key, entry);
			}
			throw error;
		}
		return entry.state;
	}

	private schedule(key: string, entry: Entry) {
		this.timers.clear(entry.timer);
		if (!entry.state.autoContinue || !entry.state.resetAt) return;
		// Recheck wall-clock time at least once a minute (sleep, clock changes,
		// long weekly limits); never overflow setTimeout or wake the computer.
		const delay = Math.max(
			0,
			Math.min(60_000, entry.state.resetAt + 1_000 - this.now()),
		);
		entry.timer = this.timers.set(() => {
			if (this.entries.get(key) !== entry || !entry.state.autoContinue) return;
			if (this.now() < (entry.state.resetAt ?? Infinity) + 1_000) {
				this.schedule(key, entry);
				return;
			}
			void this.continue(key).catch(() => {});
		}, delay);
		entry.timer.unref?.();
	}

	async continue(key: string) {
		if (this.attempts.has(key)) return;
		const entry = this.entries.get(key);
		if (!entry)
			throw new Error("This session is no longer waiting for a usage reset.");
		if (entry.state.continuing) return;
		this.timers.clear(entry.timer);
		// Consume the opt-in BEFORE calling the provider: no repeated sends on a
		// rejected turn, dropped response, duplicate click, or another quota error.
		entry.state = {
			...entry.state,
			autoContinue: false,
			continuing: true,
			error: undefined,
		};
		this.attempts.set(key, entry);
		this.emit(key, entry);
		try {
			await this.callbacks.resume(key);
			if (this.entries.get(key) === entry) this.clear(key);
		} catch (error) {
			if (this.attempts.get(key) !== entry) throw error;
			const current = this.entries.get(key) ?? entry;
			current.state = {
				...current.state,
				autoContinue: false,
				continuing: false,
				error: error instanceof Error ? error.message : String(error),
			};
			this.entries.set(key, current);
			this.emit(key, current);
			throw error;
		} finally {
			if (this.attempts.get(key) === entry) this.attempts.delete(key);
		}
	}

	cancel(key: string) {
		this.attempts.delete(key);
		const entry = this.entries.get(key);
		if (!entry) return;
		this.timers.clear(entry.timer);
		entry.state = { ...entry.state, autoContinue: false, continuing: false };
		this.emit(key, entry);
	}

	clear(key: string) {
		const entry = this.entries.get(key);
		if (!entry) return;
		this.timers.clear(entry.timer);
		this.entries.delete(key);
		this.callbacks.changed(key, null);
	}

	forget(key: string) {
		this.attempts.delete(key);
		this.clear(key);
	}

	dispose() {
		for (const entry of this.entries.values()) this.timers.clear(entry.timer);
		this.entries.clear();
		this.attempts.clear();
	}

	private emit(key: string, entry: Entry) {
		this.callbacks.changed(key, entry.state);
	}
}
