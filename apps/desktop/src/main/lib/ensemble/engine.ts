import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
	createEnsembleInput,
	type EnsembleAction,
	type EnsembleGroup,
	type EnsembleMember,
	type EnsembleMessage,
	type EnsembleObservation,
	type EnsembleSession,
} from "../../../shared/ensemble";
import { collaborationPrompt, parseCollaborationReply } from "./protocol";

export interface EnsembleStorage {
	load(): EnsembleGroup[];
	save(groups: EnsembleGroup[]): void;
}
export interface EnsembleTransport {
	list(): Promise<EnsembleSession[]>;
	inspect(
		member: EnsembleMember,
		messageId?: string,
	): Promise<EnsembleObservation>;
	send(member: EnsembleMember, text: string, messageId: string): Promise<void>;
	interrupt(member: EnsembleMember): Promise<void>;
}

/** Owns delivery, never provider conversations. All side effects follow a durable state write. */
export class EnsembleEngine extends EventEmitter {
	private groups: EnsembleGroup[];
	private pumping = false;
	private again = false;
	private disposed = false;
	constructor(
		private storage: EnsembleStorage,
		readonly transport: EnsembleTransport,
	) {
		super();
		this.groups = storage.load();
		let changed = false;
		for (const g of this.groups) {
			if (g.status === "running") {
				g.status = "paused";
				g.issue = "Restored after restart. Review the journal, then resume.";
				changed = true;
			}
			for (const m of g.messages)
				if (m.status === "sending" || m.status === "delivered") {
					m.status = "uncertain";
					m.error =
						"Delivery crossed a restart. Inspect the native conversation before resolving.";
					changed = true;
				}
		}
		if (changed) storage.save(this.groups);
	}
	list() {
		return structuredClone(this.groups);
	}
	get(id: string) {
		const group = this.groups.find((g) => g.id === id);
		if (!group) throw new Error("This Flock no longer exists.");
		return structuredClone(group);
	}
	private save(group: EnsembleGroup) {
		group.updatedAt = Date.now();
		const groups = this.groups.some((g) => g.id === group.id)
			? this.groups.map((g) => (g.id === group.id ? group : g))
			: [...this.groups, group];
		this.storage.save(groups);
		this.groups = groups;
		this.emit("change");
	}
	private event(
		g: EnsembleGroup,
		kind: EnsembleGroup["events"][number]["kind"],
		text: string,
		memberId?: string,
		messageId?: string,
	) {
		g.events.push({
			id: randomUUID(),
			at: Date.now(),
			kind,
			text,
			memberId,
			messageId,
		});
	}
	async create(raw: unknown) {
		const input = createEnsembleInput.parse(raw);
		if (!input.members[input.commanderIndex])
			throw new Error("Choose a coordinator from this team.");
		if (this.groups.length >= 40)
			throw new Error(
				"Flock's local limit is 40 groups. Your existing groups are preserved.",
			);
		const sessions = await this.transport.list();
		const members = input.members.map((m, i) => {
			const session = sessions.find(
				(s) =>
					s.provider === m.provider &&
					s.key === m.key &&
					s.conversationId === m.conversationId,
			);
			if (!session)
				throw new Error(
					`${m.title} changed or closed. Refresh the session list.`,
				);
			return { ...session, title: m.title, role: m.role, id: `m${i + 1}` };
		});
		if (
			new Set(members.map((m) => `${m.provider}:${m.conversationId ?? m.key}`))
				.size !== members.length
		)
			throw new Error("Each member must be a distinct conversation.");
		const g: EnsembleGroup = {
			...input,
			id: randomUUID(),
			members,
			commanderId: members[input.commanderIndex].id,
			status: "draft",
			messages: [],
			tasks: [],
			artifacts: [],
			decisions: [],
			events: [],
			createdAt: Date.now(),
			updatedAt: Date.now(),
		};
		this.event(g, "created", "Team assembled. No messages sent.");
		this.save(g);
		return g.id;
	}
	private addMessage(
		g: EnsembleGroup,
		from: string,
		to: string,
		text: string,
		kind: EnsembleMessage["kind"] = "message",
		replyTo?: string,
	) {
		if (!g.members.some((m) => m.id === to && !m.removed))
			throw new Error("Recipient is not an active member of this group.");
		if (
			g.messages.filter((m) => m.status !== "cancelled").length >= g.maxMessages
		)
			throw new Error(
				"Message budget reached. Pause and review the result before extending the budget.",
			);
		const message: EnsembleMessage = {
			id: randomUUID(),
			from,
			to,
			text,
			kind,
			replyTo,
			createdAt: Date.now(),
			status: "queued",
		};
		g.messages.push(message);
		this.event(g, "delivery", "Message queued", to, message.id);
		return message.id;
	}
	async control(id: string, action: "start" | "pause" | "resume" | "stop") {
		const g = this.get(id);
		if (action === "pause") {
			if (g.status !== "running") return;
			g.status = "paused";
			this.event(
				g,
				"state",
				"Paused. Current turns may finish; new deliveries are held.",
			);
			this.save(g);
			return;
		}
		if (action === "stop") {
			g.status = "stopped";
			for (const m of g.messages)
				if (m.status === "queued") m.status = "cancelled";
			this.event(
				g,
				"state",
				"Stopped. Queued deliveries cancelled; owned active turns are being interrupted.",
			);
			this.save(g);
			for (const m of g.messages.filter((m) =>
				["sending", "delivered"].includes(m.status),
			)) {
				const member = g.members.find((a) => a.id === m.to);
				if (!member) continue;
				try {
					const state = await this.transport.inspect(member, m.id);
					if (!state.intervened && state.status === "working")
						await this.transport.interrupt(member);
				} catch {
					/* No blind interrupt of a disconnected or replaced conversation. */
				}
				const current = this.get(id);
				const item = current.messages.find((x) => x.id === m.id);
				if (item) {
					item.status = "uncertain";
					item.error =
						"Stopped during delivery. Inspect the native conversation.";
					this.save(current);
				}
			}
			return;
		}
		if (g.status === "completed" || g.status === "stopped")
			throw new Error(
				"This group has ended. Create a new group for further work.",
			);
		if (g.status === "running") return;
		if (g.messages.some((m) => m.status === "uncertain"))
			throw new Error("Resolve uncertain deliveries before resuming.");
		for (const other of this.groups.filter(
			(o) =>
				o.id !== id &&
				(o.status === "running" ||
					(o.status === "paused" &&
						o.messages.some((m) =>
							["sending", "delivered", "uncertain"].includes(m.status),
						))),
		)) {
			if (
				g.members.some(
					(m) =>
						!m.removed &&
						other.members.some(
							(n) =>
								!n.removed &&
								m.provider === n.provider &&
								(m.conversationId
									? m.conversationId === n.conversationId
									: m.key === n.key),
						),
				)
			)
				throw new Error(
					"A member is already active in another flock. Pause it and resolve its active deliveries first.",
				);
		}
		if (!g.messages.length)
			this.addMessage(
				g,
				"user",
				g.commanderId,
				"Organize this goal, delegate a concrete contribution to your team, request review, and synthesize a useful deliverable.",
				"brief",
			);
		g.status = "running";
		g.issue = undefined;
		this.event(
			g,
			"state",
			action === "start" ? "Collaboration started" : "Collaboration resumed",
		);
		this.save(g);
		this.wake();
	}
	message(id: string, to: string, text: string) {
		const g = this.get(id);
		if (["completed", "stopped"].includes(g.status))
			throw new Error("This group has ended.");
		if (!text.trim() || text.length > 8000)
			throw new Error("Write a message of 1–8,000 characters.");
		const targets =
			to === "all"
				? g.members.filter((m) => !m.removed).map((m) => m.id)
				: [to];
		for (const target of targets)
			this.addMessage(g, "user", target, text.trim());
		this.save(g);
		this.wake();
	}
	update(
		id: string,
		input: { goal?: string; criteria?: string; maxMessages?: number },
	) {
		const g = this.get(id);
		if (g.status !== "paused" && g.status !== "draft")
			throw new Error("Pause the group before changing its brief or limits.");
		if (input.goal !== undefined) g.goal = input.goal;
		if (input.criteria !== undefined) g.criteria = input.criteria;
		if (input.maxMessages !== undefined) g.maxMessages = input.maxMessages;
		this.event(
			g,
			"decision",
			"User updated the shared brief or delivery budget.",
		);
		this.save(g);
	}
	async addMember(id: string, input: EnsembleMember) {
		const g = this.get(id);
		if (!["paused", "draft"].includes(g.status))
			throw new Error("Pause before changing the team.");
		if (g.members.filter((m) => !m.removed).length >= 6)
			throw new Error("A flock supports up to six active members.");
		const live = (await this.transport.list()).find(
			(s) =>
				s.key === input.key &&
				s.provider === input.provider &&
				s.conversationId === input.conversationId,
		);
		if (
			!live ||
			g.members.some(
				(m) =>
					!m.removed &&
					m.provider === live.provider &&
					(m.key === live.key ||
						(live.conversationId && m.conversationId === live.conversationId)),
			)
		)
			throw new Error("Choose a different, open conversation.");
		g.members.push({
			...live,
			role: input.role,
			id: `m${g.members.length + 1}`,
		});
		this.event(g, "member", `${live.title} joined`);
		this.save(g);
	}
	removeMember(id: string, memberId: string) {
		const g = this.get(id);
		if (!["paused", "draft"].includes(g.status))
			throw new Error("Pause before changing the team.");
		if (memberId === g.commanderId)
			throw new Error("The coordinator remains until this group ends.");
		if (g.members.filter((m) => !m.removed).length <= 2)
			throw new Error("Keep at least two members.");
		if (
			g.messages.some(
				(m) =>
					m.to === memberId &&
					["sending", "delivered", "uncertain"].includes(m.status),
			) ||
			g.tasks.some((t) => t.owner === memberId && t.status !== "done")
		)
			throw new Error(
				"Resolve this member's deliveries and tasks before removing them.",
			);
		const m = g.members.find((m) => m.id === memberId);
		if (!m) return;
		m.removed = true;
		for (const msg of g.messages)
			if (msg.to === memberId && msg.status === "queued")
				msg.status = "cancelled";
		this.event(g, "member", `${m.title} left the group`, memberId);
		this.save(g);
	}
	resolve(id: string, messageId: string, retry: boolean) {
		const g = this.get(id);
		const m = g.messages.find((m) => m.id === messageId);
		if (g.status !== "paused" || m?.status !== "uncertain")
			throw new Error("Pause and select an uncertain delivery first.");
		m.status = "cancelled";
		if (retry) this.addMessage(g, m.from, m.to, m.text, m.kind, m.replyTo);
		this.event(
			g,
			"decision",
			retry
				? "User explicitly requeued a delivery after inspection"
				: "User dismissed an uncertain delivery",
			m.to,
			m.id,
		);
		this.save(g);
	}
	wake() {
		if (!this.disposed)
			void this.pump().catch((error: unknown) => {
				// A disk failure must not leave a live dispatcher running or hide a possibly accepted turn.
				for (const group of this.groups)
					if (["running", "paused"].includes(group.status)) {
						group.status = "paused";
						group.issue =
							"The coordinator could not save its journal. Delivery is paused; inspect active conversations before resuming.";
						for (const message of group.messages)
							if (message.status === "sending") {
								message.status = "uncertain";
								message.error = "Journal write failed during delivery.";
							}
					}
				try {
					this.storage.save(this.groups);
				} catch {
					/* The previous atomic snapshot remains intact. */
				}
				this.emit("change");
				this.emit("fault", error);
			});
	}
	dispose() {
		this.disposed = true;
		this.removeAllListeners();
	}
	async pump() {
		if (this.pumping) {
			this.again = true;
			return;
		}
		this.pumping = true;
		try {
			do {
				this.again = false;
				for (const group of this.list().filter(
					(g) => g.status === "running" || g.status === "paused",
				))
					await this.process(group.id);
			} while (this.again && !this.disposed);
		} finally {
			this.pumping = false;
		}
	}
	private async process(id: string) {
		let group = this.get(id);
		for (const delivery of group.messages.filter(
			(m) => m.status === "delivered",
		)) {
			const member = group.members.find((m) => m.id === delivery.to);
			if (!member) continue;
			let observation: EnsembleObservation;
			try {
				observation = await this.transport.inspect(member, delivery.id);
			} catch {
				continue;
			}
			group = this.get(id);
			const message = group.messages.find((m) => m.id === delivery.id);
			if (!message || message.status !== "delivered") continue;
			if (
				observation.intervened ||
				(member.conversationId &&
					observation.conversationId !== member.conversationId) ||
				["error", "offline"].includes(observation.status)
			) {
				message.status = "uncertain";
				message.error = observation.intervened
					? "Another user turn entered the conversation. Review it before continuing."
					: observation.error || "The conversation disconnected or changed.";
				group.status = "paused";
				group.issue = message.error;
				this.event(group, "issue", message.error, member.id, message.id);
				this.save(group);
				continue;
			}
			if (!member.conversationId && observation.conversationId) {
				const bound = group.members.find((m) => m.id === member.id);
				if (bound) bound.conversationId = observation.conversationId;
			}
			if (observation.response) {
				message.status = "answered";
				message.answeredAt = Date.now();
				message.reply = observation.response.text.slice(0, 65000);
				this.event(
					group,
					"reply",
					observation.response.successful
						? "Response received"
						: "Provider turn failed",
					member.id,
					message.id,
				);
				if (!observation.response.successful) {
					group.status = "paused";
					group.issue =
						"A provider turn failed. Inspect the response before resuming.";
					message.actionsApplied = true;
				}
				this.save(group);
			}
		}
		group = this.get(id);
		if (group.status !== "running") return;
		for (const message of group.messages.filter(
			(m) => m.status === "answered" && !m.actionsApplied,
		)) {
			const next = this.get(id);
			const current = next.messages.find((m) => m.id === message.id);
			if (!current) continue;
			// Validate and apply the entire response on a clone. A bad action cannot partially route a batch.
			try {
				const reply = parseCollaborationReply(message.reply ?? "");
				current.actionsApplied = true;
				for (const action of reply.actions) this.apply(next, message, action);
				this.save(next);
			} catch (error) {
				const failed = this.get(id);
				const entry = failed.messages.find((m) => m.id === message.id);
				if (entry) {
					entry.actionsApplied = true;
					entry.error =
						error instanceof Error
							? error.message
							: "Invalid collaboration response";
				}
				failed.status = "paused";
				failed.issue = entry?.error;
				this.event(
					failed,
					"issue",
					failed.issue ?? "Response held for inspection",
					message.to,
					message.id,
				);
				this.save(failed);
				return;
			}
		}
		group = this.get(id);
		if (group.status !== "running") return;
		if (
			!group.messages.some((message) =>
				["queued", "sending", "delivered"].includes(message.status),
			)
		) {
			group.status = "paused";
			group.issue =
				"The team has no pending handoff and has not delivered a final result. Give the coordinator direction, then resume.";
			this.event(group, "issue", group.issue);
			this.save(group);
			return;
		}
		for (const queued of group.messages.filter((m) => m.status === "queued")) {
			group = this.get(id);
			if (group.status !== "running") return;
			const inFlight = group.messages.filter(
				(m) => m.status === "sending" || m.status === "delivered",
			);
			if (inFlight.length >= group.concurrency) return;
			const member = group.members.find(
				(m) => m.id === queued.to && !m.removed,
			);
			if (!member) continue;
			const directory = (value: string) =>
				value.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
			if (
				inFlight.some(
					(m) =>
						m.to === member.id ||
						directory(group.members.find((a) => a.id === m.to)?.cwd ?? "") ===
							directory(member.cwd),
				)
			)
				continue;
			if (
				group.tasks.some(
					(t) =>
						t.owner === member.id &&
						t.status !== "done" &&
						t.dependsOn.some(
							(d) => group.tasks.find((p) => p.id === d)?.status !== "done",
						),
				)
			)
				continue;
			let observation: EnsembleObservation;
			try {
				observation = await this.transport.inspect(member);
			} catch {
				continue;
			}
			if (observation.status !== "idle") continue;
			if (
				member.conversationId &&
				observation.conversationId !== member.conversationId
			)
				continue;
			group = this.get(id);
			if (group.status !== "running") return;
			const message = group.messages.find((m) => m.id === queued.id);
			if (message?.status !== "queued") continue;
			message.status = "sending";
			this.save(group);
			try {
				await this.transport.send(
					member,
					collaborationPrompt(group, message),
					message.id,
				);
				const sent = this.get(id);
				const entry = sent.messages.find((m) => m.id === message.id);
				if (entry && entry.status === "sending") {
					entry.status = "delivered";
					entry.deliveredAt = Date.now();
					this.event(
						sent,
						"delivery",
						"Accepted by native session",
						member.id,
						message.id,
					);
					this.save(sent);
				}
			} catch (error) {
				const failed = this.get(id);
				const entry = failed.messages.find((m) => m.id === message.id);
				if (entry) {
					entry.status = "uncertain";
					entry.error =
						error instanceof Error ? error.message : "Delivery failed";
				}
				failed.status = "paused";
				failed.issue =
					"Delivery was not confirmed. Inspect the native conversation; no automatic retry.";
				this.event(failed, "issue", failed.issue, member.id, message.id);
				this.save(failed);
				return;
			}
		}
	}
	private apply(
		g: EnsembleGroup,
		message: EnsembleMessage,
		action: EnsembleAction,
	) {
		if (g.status === "completed")
			throw new Error("Completion must be the final action in a response.");
		const actor = message.to;
		const coordinator = actor === g.commanderId;
		if (action.type === "send") {
			this.addMessage(
				g,
				actor,
				action.to,
				action.text,
				action.kind,
				message.id,
			);
			return;
		}
		if (action.type === "task") {
			if (!g.members.some((m) => m.id === action.owner && !m.removed))
				throw new Error("Task owner must be a group member.");
			const old = g.tasks.find((t) => t.id === action.id);
			if (
				!coordinator &&
				(action.owner !== actor || (old && old.owner !== actor))
			)
				throw new Error(
					"Only the coordinator may assign another member's tasks.",
				);
			if (
				action.dependsOn.some(
					(d) => d === action.id || !g.tasks.some((t) => t.id === d),
				)
			)
				throw new Error("Dependencies must refer to existing other tasks.");
			const task = {
				id: action.id,
				title: action.title,
				owner: action.owner,
				status: action.status,
				dependsOn: action.dependsOn,
			};
			const tasks = old
				? g.tasks.map((t) => (t.id === task.id ? task : t))
				: [...g.tasks, task];
			const byId = new Map(tasks.map((entry) => [entry.id, entry]));
			const visiting = new Set<string>();
			const visited = new Set<string>();
			const visit = (id: string): boolean => {
				if (visiting.has(id)) return true;
				if (visited.has(id)) return false;
				visiting.add(id);
				if (byId.get(id)?.dependsOn.some(visit)) return true;
				visiting.delete(id);
				visited.add(id);
				return false;
			};
			if (visit(task.id))
				throw new Error("Task dependencies cannot form a cycle.");
			if (tasks.length > 40)
				throw new Error("Keep this group to 40 tasks or fewer.");
			g.tasks = tasks;
			this.event(g, "task", `${task.title}: ${task.status}`, actor, message.id);
			return;
		}
		if (action.type === "artifact") {
			let artifact = g.artifacts.find((a) => a.id === action.id);
			if (!artifact) {
				if (g.artifacts.length >= 20)
					throw new Error("Keep this group to 20 artifacts or fewer.");
				artifact = {
					id: action.id,
					title: action.title,
					versions: [],
					reviews: [],
				};
				g.artifacts.push(artifact);
			}
			if (artifact.versions.length >= 20)
				throw new Error("Artifact revision limit reached.");
			artifact.title = action.title;
			artifact.versions.push({
				body: action.body,
				author: actor,
				at: Date.now(),
				messageId: message.id,
			});
			this.event(
				g,
				"artifact",
				`${artifact.title} · revision ${artifact.versions.length}`,
				actor,
				message.id,
			);
			return;
		}
		if (action.type === "review") {
			const artifact = g.artifacts.find((a) => a.id === action.artifactId);
			if (!artifact || !artifact.versions[action.version - 1])
				throw new Error("Review must reference an existing artifact revision.");
			artifact.reviews.push({
				author: actor,
				text: action.text,
				version: action.version,
				at: Date.now(),
				messageId: message.id,
			});
			this.event(
				g,
				"artifact",
				`${artifact.title} reviewed`,
				actor,
				message.id,
			);
			return;
		}
		if (!coordinator)
			throw new Error(
				"Only the coordinator can record group decisions or completion.",
			);
		if (action.type === "decision") {
			g.decisions.push({ text: action.text, author: actor, at: Date.now() });
			this.event(g, "decision", action.text, actor, message.id);
			return;
		}
		const artifact = g.artifacts.find((a) => a.id === action.artifactId);
		if (
			!artifact ||
			!artifact.reviews.some(
				(r) =>
					r.version === artifact.versions.length &&
					r.author !== artifact.versions.at(-1)?.author,
			)
		)
			throw new Error(
				"Completion needs an independent review of the current artifact revision.",
			);
		if (
			g.tasks.some((t) => t.status !== "done") ||
			g.messages.some((m) =>
				["queued", "sending", "delivered", "uncertain"].includes(m.status),
			)
		)
			throw new Error(
				"Finish the open tasks and deliveries before completing.",
			);
		g.result = { artifactId: artifact.id, text: action.text, at: Date.now() };
		g.status = "completed";
		this.event(
			g,
			"state",
			"Coordinator delivered the reviewed result",
			actor,
			message.id,
		);
	}
}
