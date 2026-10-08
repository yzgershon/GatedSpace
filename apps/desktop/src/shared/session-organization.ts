import { z } from "zod";

export const organizedSession = z.object({
	provider: z.enum(["claude", "codex"]),
	sessionId: z.string().uuid(),
	title: z.string().trim().min(1).max(120),
	cwd: z.string().nullable(),
	lastModified: z.number().finite(),
});
export type OrganizedSession = z.infer<typeof organizedSession>;
export const sessionKey = (
	session: Pick<OrganizedSession, "provider" | "sessionId">,
) => `${session.provider}:${session.sessionId}`;
const key = z.string().regex(/^(claude|codex):[0-9a-f-]{36}$/i);
const projectId = z.string().uuid();
const name = z.string().trim().min(1).max(60);
export const organizationSchema = z.object({
	version: z.literal(1),
	projects: z
		.array(z.object({ id: projectId, name, sessions: z.array(key).max(10000) }))
		.max(200),
	bookmarks: z.record(key, organizedSession),
	pinnedOrder: z.array(key).max(200),
	collapsed: z.array(z.string().max(100)).max(202),
});
export type SessionOrganization = z.infer<typeof organizationSchema>;
export const emptyOrganization = (): SessionOrganization => ({
	version: 1,
	projects: [],
	bookmarks: {},
	pinnedOrder: [],
	collapsed: [],
});
export const organizationCommand = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("createProject"),
		name,
		session: organizedSession.optional(),
	}),
	z.object({ type: z.literal("renameProject"), id: projectId, name }),
	z.object({ type: z.literal("removeProject"), id: projectId }),
	z.object({
		type: z.literal("moveProject"),
		id: projectId,
		target: projectId,
		after: z.boolean(),
	}),
	z.object({
		type: z.literal("assign"),
		session: organizedSession,
		projectId: projectId.nullable(),
		target: key.optional(),
		after: z.boolean().optional(),
	}),
	z.object({
		type: z.literal("movePin"),
		key,
		target: key,
		after: z.boolean(),
	}),
	z.object({
		type: z.literal("collapse"),
		id: z.string().max(100),
		collapsed: z.boolean(),
	}),
]);
export type OrganizationCommand = z.infer<typeof organizationCommand>;

/** Moves relative to a visible neighbour, keeping every filtered-out item intact. */
export function moveRelative(
	order: string[],
	item: string,
	target: string,
	after: boolean,
) {
	if (item === target || !order.includes(target)) return order;
	const next = order.filter((id) => id !== item);
	next.splice(next.indexOf(target) + Number(after), 0, item);
	return next;
}

export function orderedPins<T extends OrganizedSession & { pinned?: boolean }>(
	rows: T[],
	order: string[],
) {
	const ranks = new Map(order.map((id, index) => [id, index]));
	return rows
		.filter((row) => row.pinned)
		.sort(
			(a, b) =>
				(ranks.get(sessionKey(a)) ?? Infinity) -
					(ranks.get(sessionKey(b)) ?? Infinity) ||
				b.lastModified - a.lastModified,
		);
}

export function projectForSession(state: SessionOrganization, key: string) {
	return state.projects.find((project) => project.sessions.includes(key));
}

/** Validated metadata transition, shared by the store and isolated UI fixtures. */
export function updateOrganization(
	current: SessionOrganization,
	raw: OrganizationCommand,
	pins: OrganizedSession[] = [],
) {
	const command = organizationCommand.parse(raw);
	const state = organizationSchema.parse(current);
	const requireProject = (id: string) => {
		const project = state.projects.find((p) => p.id === id);
		if (!project)
			throw new Error("This project no longer exists. Refresh and try again.");
		return project;
	};
	const uniqueName = (name: string, except?: string) => {
		if (
			state.projects.some(
				(p) =>
					p.id !== except &&
					p.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
			)
		)
			throw new Error("A project with this name already exists.");
	};
	switch (command.type) {
		case "createProject": {
			uniqueName(command.name);
			if (state.projects.length >= 200)
				throw new Error("You can create up to 200 session projects.");
			const project = {
				id: crypto.randomUUID(),
				name: command.name,
				sessions: [] as string[],
			};
			if (command.session) {
				const key = sessionKey(command.session);
				for (const p of state.projects)
					p.sessions = p.sessions.filter((id) => id !== key);
				project.sessions.push(key);
				state.bookmarks[key] = command.session;
			}
			state.projects.push(project);
			break;
		}
		case "renameProject":
			uniqueName(command.name, command.id);
			requireProject(command.id).name = command.name;
			break;
		case "removeProject":
			requireProject(command.id);
			state.projects = state.projects.filter((p) => p.id !== command.id);
			state.collapsed = state.collapsed.filter((id) => id !== command.id);
			// Keep bookmarks: even very old conversations return to Unsorted.
			break;
		case "moveProject": {
			requireProject(command.id);
			requireProject(command.target);
			const order = moveRelative(
				state.projects.map((p) => p.id),
				command.id,
				command.target,
				command.after,
			);
			state.projects.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
			break;
		}
		case "assign": {
			const project = command.projectId
				? requireProject(command.projectId)
				: null;
			if (command.target && !project?.sessions.includes(command.target))
				throw new Error("The target session moved. Refresh and try again.");
			const key = sessionKey(command.session);
			if (key === command.target) break;
			for (const p of state.projects)
				p.sessions = p.sessions.filter((id) => id !== key);
			state.bookmarks[key] = command.session;
			if (project) {
				project.sessions.push(key);
				if (command.target)
					project.sessions = moveRelative(
						project.sessions,
						key,
						command.target,
						command.after ?? false,
					);
				state.collapsed = state.collapsed.filter((id) => id !== project.id);
			}
			break;
		}
		case "movePin": {
			const order = orderedPins(
				pins.map((p) => ({ ...p, pinned: true })),
				state.pinnedOrder,
			).map(sessionKey);
			if (!order.includes(command.key) || !order.includes(command.target))
				throw new Error(
					"A session is no longer pinned. Refresh and try again.",
				);
			state.pinnedOrder = moveRelative(
				order,
				command.key,
				command.target,
				command.after,
			);
			break;
		}
		case "collapse": {
			if (
				!["@pinned", "@unsorted", ...state.projects.map((p) => p.id)].includes(
					command.id,
				)
			)
				throw new Error("This section no longer exists.");
			state.collapsed = state.collapsed.filter((id) => id !== command.id);
			if (command.collapsed) state.collapsed.push(command.id);
			break;
		}
	}
	return organizationSchema.parse(state);
}
