export interface CodexPreferences {
	model?: string;
	effort?: string;
	fast?: boolean;
}

type StorageAccess = () => Pick<Storage, "getItem" | "setItem">;

function preferences(value: unknown): CodexPreferences {
	if (!value || typeof value !== "object") return {};
	const v = value as Record<string, unknown>;
	return {
		...(typeof v.model === "string" && v.model ? { model: v.model } : {}),
		...(typeof v.effort === "string" && v.effort ? { effort: v.effort } : {}),
		...(typeof v.fast === "boolean" ? { fast: v.fast } : {}),
	};
}

/** User choices, separate from provider defaults and transient queued prompts. */
export class CodexPreferenceStore {
	private sessions = new Map<string, string>();
	private cache = new Map<string, CodexPreferences>();
	private pending = new Map<string, CodexPreferences>();
	constructor(private storage: StorageAccess) {}

	private read(key: string): CodexPreferences {
		const cached = this.cache.get(key);
		if (cached) return cached;
		let value: CodexPreferences = {};
		try {
			value = preferences(JSON.parse(this.storage().getItem(key) ?? "null"));
		} catch {
			/* Unavailable or old storage must not prevent opening a session. */
		}
		this.cache.set(key, value);
		return value;
	}

	private save(key: string, value: CodexPreferences) {
		this.cache.set(key, value);
		try {
			this.storage().setItem(key, JSON.stringify(value));
		} catch {
			/* Retain in memory. */
		}
	}

	get(pane: string) {
		const session = this.sessions.get(pane);
		return this.read(
			session
				? `codex-preferences:thread:${session}`
				: `codex-preferences:pane:${pane}`,
		);
	}

	update(pane: string, patch: CodexPreferences) {
		const clean = preferences(patch);
		if (!Object.keys(clean).length) return;
		const value = { ...this.get(pane), ...clean };
		this.save(`codex-preferences:pane:${pane}`, value);
		const session = this.sessions.get(pane);
		if (session) this.save(`codex-preferences:thread:${session}`, value);
		else this.pending.set(pane, { ...this.pending.get(pane), ...clean });
	}

	bind(pane: string, session: string) {
		if (this.sessions.get(pane) === session) return this.get(pane);
		const thread = this.read(`codex-preferences:thread:${session}`);
		// A choice made while connection starts wins; otherwise the conversation
		// wins over a reused pane. First-time conversations inherit their pane.
		const value = {
			...(Object.keys(thread).length ? thread : this.get(pane)),
			...this.pending.get(pane),
		};
		this.sessions.set(pane, session);
		this.pending.delete(pane);
		this.save(`codex-preferences:thread:${session}`, value);
		this.save(`codex-preferences:pane:${pane}`, value);
		return value;
	}
}
