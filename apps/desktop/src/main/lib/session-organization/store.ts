import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
	emptyOrganization,
	type OrganizationCommand,
	type OrganizedSession,
	orderedPins,
	organizationSchema,
	type SessionOrganization,
	sessionKey,
	updateOrganization,
} from "shared/session-organization";

/** Organization metadata only: never moves files or changes a session's working directory. */
export class SessionOrganizationStore extends EventEmitter {
	constructor(private readonly file: string) {
		super();
	}
	read(): SessionOrganization {
		try {
			return organizationSchema.parse(
				JSON.parse(readFileSync(this.file, "utf8")),
			);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT")
				return emptyOrganization();
			throw new Error(
				"Could not read your session projects. The saved file has been preserved.",
			);
		}
	}
	private save(state: SessionOrganization) {
		const valid = organizationSchema.parse(state);
		mkdirSync(dirname(this.file), { recursive: true });
		const temp = `${this.file}.${process.pid}.tmp`;
		writeFileSync(temp, JSON.stringify(valid, null, 2), "utf8");
		renameSync(temp, this.file);
		this.emit("change", valid);
		return valid;
	}
	apply(raw: OrganizationCommand, pins: OrganizedSession[] = []) {
		return this.save(updateOrganization(this.read(), raw, pins));
	}
	/** Seed old pins once; newly pinned sessions append instead of activity re-sorting the list. */
	syncPins(pins: OrganizedSession[]) {
		const state = this.read();
		const order = orderedPins(
			pins.map((p) => ({ ...p, pinned: true })),
			state.pinnedOrder,
		).map(sessionKey);
		if (JSON.stringify(order) === JSON.stringify(state.pinnedOrder))
			return state;
		state.pinnedOrder = order;
		return this.save(state);
	}

	forget(session: Pick<OrganizedSession, "provider" | "sessionId">) {
		const state = this.read();
		const key = sessionKey(session);
		delete state.bookmarks[key];
		for (const p of state.projects)
			p.sessions = p.sessions.filter((id) => id !== key);
		state.pinnedOrder = state.pinnedOrder.filter((id) => id !== key);
		this.save(state);
	}
}
