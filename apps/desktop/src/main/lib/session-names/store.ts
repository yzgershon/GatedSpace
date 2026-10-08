import { EventEmitter } from "node:events";
import {
	cleanSessionName,
	type SessionNameRef,
	type SessionNamesSnapshot,
	sessionNameKey,
} from "../../../shared/session-names";

/** One naming authority. Only explicitly registered new sessions can be auto-named. */
export class SessionNameStore extends EventEmitter {
	private snapshot: SessionNamesSnapshot;
	private fresh = new Set<string>();
	private prompts = new Set<string>();
	private epochs = new Map<string, number>();
	private terminals = new Map<string, number>();
	private legacyNames = new Map<string, string | null>();
	constructor(
		private io: {
			load(): SessionNamesSnapshot;
			save(value: SessionNamesSnapshot): void;
			legacy(id: string): string | null;
			mirror(id: string, title: string | null): void;
			generate(prompt: string): Promise<string | null>;
		},
	) {
		super();
		this.snapshot = io.load();
	}
	read() {
		return this.snapshot;
	}
	private legacy(id: string) {
		if (!this.legacyNames.has(id)) this.legacyNames.set(id, this.io.legacy(id));
		return this.legacyNames.get(id) ?? null;
	}
	private mirror(id: string, title: string | null) {
		this.io.mirror(id, title);
		this.legacyNames.set(id, title);
	}
	private canonical(ref: SessionNameRef) {
		const key = sessionNameKey(ref);
		return this.snapshot.aliases[key] ?? key;
	}
	get(ref: SessionNameRef): string | undefined {
		const key = this.canonical(ref);
		const id = key.slice(key.indexOf(":") + 1);
		return (
			this.snapshot.names[key]?.title ??
			(!key.startsWith("terminal:") && !id.startsWith("pending:")
				? (this.legacy(id) ?? undefined)
				: undefined)
		);
	}
	private publish(next: SessionNamesSnapshot, required = true) {
		try {
			this.io.save(next);
		} catch (error) {
			if (required) throw error;
			console.warn("[session-names] could not persist session binding", error);
		}
		this.snapshot = next;
		this.emit("change", next);
	}
	open(ref: SessionNameRef, isNew: boolean) {
		if (
			isNew &&
			!ref.id &&
			ref.key &&
			this.snapshot.aliases[sessionNameKey(ref)]
		) {
			const aliases = { ...this.snapshot.aliases };
			delete aliases[sessionNameKey(ref)];
			this.publish({ ...this.snapshot, aliases }, false);
		}
		if (isNew && !this.get(ref)) this.fresh.add(this.canonical(ref));
	}
	bind(provider: SessionNameRef["provider"], key: string, id: string) {
		const pending = sessionNameKey({ provider, key });
		const target = sessionNameKey({ provider, id });
		if (this.snapshot.aliases[pending] === target) return;
		const names = { ...this.snapshot.names };
		// Never transfer a pane's old conversation name onto a replacement/fork.
		if (names[pending] && !names[target] && !this.legacy(id)) {
			names[target] = names[pending];
			if (provider !== "terminal") this.mirror(id, names[target].title);
		}
		delete names[pending];
		if (this.fresh.delete(pending)) this.fresh.add(target);
		if (this.prompts.delete(pending)) this.prompts.add(target);
		this.publish(
			{
				names,
				aliases: { ...this.snapshot.aliases, [pending]: target },
			},
			false,
		);
	}
	startTerminal(id: string) {
		this.terminals.set(id, Date.now());
		this.open({ provider: "terminal", id }, true);
	}
	terminalStartedAt(id: string) {
		return this.snapshot.aliases[
			sessionNameKey({ provider: "terminal", id })
		] && this.get({ provider: "terminal", id })
			? undefined
			: this.terminals.get(id);
	}
	finishTerminal(id: string) {
		this.terminals.delete(id);
	}
	/** Bind a terminal to the CLI conversation so its recent/mobile name is identical. */
	bindTerminal(
		terminalId: string,
		provider: "claude" | "codex",
		id: string,
		isNew: boolean,
	) {
		const source = sessionNameKey({ provider: "terminal", id: terminalId });
		const target = sessionNameKey({ provider, id });
		if (this.snapshot.aliases[source] === target) {
			if (
				isNew &&
				this.terminals.has(terminalId) &&
				!this.get({ provider, id })
			)
				this.fresh.add(target);
			return;
		}
		const names = { ...this.snapshot.names };
		if (
			names[source] &&
			(isNew || names[source].source === "manual") &&
			!names[target] &&
			!this.legacy(id)
		)
			names[target] = names[source];
		delete names[source];
		const fresh = this.fresh.delete(source);
		if (fresh && isNew && !names[target] && !this.legacy(id))
			this.fresh.add(target);
		if (this.prompts.delete(source) && isNew) this.prompts.add(target);
		this.publish(
			{
				names,
				aliases: { ...this.snapshot.aliases, [source]: target },
			},
			false,
		);
		if (names[target]) this.mirror(id, names[target].title);
	}
	rename(ref: SessionNameRef, title: string | null) {
		const key = this.canonical(ref);
		this.epochs.set(key, (this.epochs.get(key) ?? 0) + 1);
		this.fresh.delete(key);
		const next = cleanSessionName(title ?? "");
		const names = { ...this.snapshot.names };
		if (next) names[key] = { title: next, source: "manual" };
		else delete names[key];
		const provider = key.slice(0, key.indexOf(":"));
		const id = key.slice(key.indexOf(":") + 1);
		if (provider !== "terminal" && !id.startsWith("pending:"))
			this.mirror(id, next || null);
		this.publish({ ...this.snapshot, names });
	}
	/** Accept an intelligent title from the live agent without letting it rename existing sessions. */
	suggest(ref: SessionNameRef, value: string) {
		const key = this.canonical(ref);
		const title = cleanSessionName(value)
			.replace(/^["'`]+|["'`]+$/g, "")
			.slice(0, 64);
		if (
			!title ||
			!this.fresh.has(key) ||
			!this.prompts.has(key) ||
			this.snapshot.names[key]?.source === "manual"
		)
			return false;
		const provider = key.slice(0, key.indexOf(":"));
		const id = key.slice(key.indexOf(":") + 1);
		if (
			!id.startsWith("pending:") &&
			provider !== "terminal" &&
			this.legacy(id)
		)
			return false;
		if (provider !== "terminal" && !id.startsWith("pending:"))
			this.mirror(id, title);
		this.publish({
			...this.snapshot,
			names: { ...this.snapshot.names, [key]: { title, source: "generated" } },
		});
		this.fresh.delete(key);
		return true;
	}
	firstPrompt(ref: SessionNameRef, prompt: string): void {
		const key = this.canonical(ref);
		if (
			!prompt.trim() ||
			prompt.trim().startsWith("/") ||
			!this.fresh.has(key) ||
			this.prompts.has(key) ||
			this.get(ref)
		)
			return;
		this.prompts.add(key);
		const epoch = this.epochs.get(key) ?? 0;
		void this.io
			.generate(prompt.slice(0, 12_000))
			.then((title) => {
				if (title && (this.epochs.get(key) ?? 0) === epoch)
					this.suggest(ref, title);
			})
			.catch(() => {
				/* The active agent may still supply the title; naming must never block the task. */
			});
	}
}
