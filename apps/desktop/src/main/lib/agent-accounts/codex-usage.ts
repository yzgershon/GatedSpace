import type { CodexLimits } from "../../../shared/codex-session/controls";

export interface CodexUsageSnapshot {
	limits: CodexLimits | null;
	updatedAt: number | null;
	error: string | null;
}

/** Account/model-scoped cache; one failed account must never borrow another's data. */
export class CodexAccountUsage {
	private cache = new Map<
		string,
		{ checkedAt: number; value: CodexUsageSnapshot }
	>();
	private pending = new Map<string, Promise<CodexUsageSnapshot>>();
	constructor(
		private readonly read: (id: string, model?: string) => Promise<CodexLimits>,
		private readonly now = Date.now,
	) {}
	get(id: string, model?: string, force = false): Promise<CodexUsageSnapshot> {
		const key = JSON.stringify([id, model ?? ""]);
		const pending = this.pending.get(key);
		if (pending) return pending;
		const cached = this.cache.get(key);
		if (!force && cached && this.now() - cached.checkedAt < 30_000)
			return Promise.resolve(cached.value);
		const request = this.read(id, model)
			.then((limits) => ({ limits, updatedAt: this.now(), error: null }))
			.catch(() => ({
				limits: cached?.value.limits ?? null,
				updatedAt: cached?.value.updatedAt ?? null,
				error: "Usage unavailable. Retry or check this account's sign-in.",
			}))
			.then((value) => {
				this.cache.set(key, { checkedAt: this.now(), value });
				return value;
			})
			.finally(() => this.pending.delete(key));
		this.pending.set(key, request);
		return request;
	}
}
