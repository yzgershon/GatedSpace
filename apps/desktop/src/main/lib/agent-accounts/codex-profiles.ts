import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ensureSecureDir, writeSecureFile } from "../secure-file";

export interface CodexProfile {
	id: string;
	label: string;
	home: string;
}
interface Saved {
	activeId: string;
	profiles: CodexProfile[];
	threads: Record<string, string>;
}

export function accountNickname(value: string, existing: string[] = []) {
	const label = value.trim();
	if (
		!label ||
		label.length > 40 ||
		[...label].some((char) => char.charCodeAt(0) < 32)
	)
		throw new Error("Give this account a nickname (1–40 characters).");
	if (
		existing.some(
			(name) => name.toLocaleLowerCase() === label.toLocaleLowerCase(),
		)
	)
		throw new Error(
			"That nickname is already in use. Choose a different nickname.",
		);
	return label;
}

export class CodexProfiles {
	constructor(
		readonly root = join(homedir(), ".superset", "codex-accounts"),
		readonly defaultHome = process.env.CODEX_HOME || join(homedir(), ".codex"),
	) {}
	private read(): Saved {
		const fallback: Saved = {
			activeId: "default",
			profiles: [
				{
					id: "default",
					label: "Existing Codex account",
					home: this.defaultHome,
				},
			],
			threads: {},
		};
		const path = join(this.root, "profiles.json");
		if (!existsSync(path)) return fallback;
		// A damaged registry must not silently reset an account binding.
		const saved = JSON.parse(readFileSync(path, "utf8")) as Saved;
		if (
			!Array.isArray(saved.profiles) ||
			!saved.profiles.some((p) => p.id === saved.activeId) ||
			!saved.threads
		)
			throw new Error("Could not read saved Codex accounts.");
		return saved;
	}
	private write(saved: Saved) {
		ensureSecureDir(this.root);
		const file = join(this.root, "profiles.json");
		writeSecureFile(`${file}.tmp`, JSON.stringify(saved));
		renameSync(`${file}.tmp`, file);
	}
	list() {
		return this.read();
	}
	get(id: string) {
		const profile = this.read().profiles.find((p) => p.id === id);
		if (!profile) throw new Error("This Codex account is no longer available.");
		return profile;
	}
	resolve(threadId?: string) {
		const saved = this.read();
		// Conversations created before account profiles used the original login.
		// Changing the default applies only to new conversations.
		return threadId ? saved.threads[threadId] || "default" : saved.activeId;
	}
	add(nickname: string) {
		const saved = this.read();
		const label = accountNickname(
			nickname,
			saved.profiles.map((p) => p.label),
		);
		const id = randomUUID();
		const profile = { id, label, home: join(this.root, id) };
		ensureSecureDir(profile.home);
		saved.profiles.push(profile);
		this.write(saved);
		return profile;
	}
	rename(id: string, nickname: string) {
		const saved = this.read();
		const profile = saved.profiles.find((p) => p.id === id);
		if (!profile) throw new Error("Account not found.");
		profile.label = accountNickname(
			nickname,
			saved.profiles.filter((p) => p.id !== id).map((p) => p.label),
		);
		this.write(saved);
	}
	select(id: string) {
		this.get(id);
		const saved = this.read();
		saved.activeId = id;
		this.write(saved);
	}
	bind(threadId: string, id: string) {
		this.get(id);
		const saved = this.read();
		saved.threads[threadId] = id;
		this.write(saved);
	}
}
export const codexProfiles = new CodexProfiles();
