import type { AgentDefinitionId } from "@superset/shared/agent-catalog";
import {
	and,
	desc,
	eq,
	inArray,
	isNotNull,
	isNull,
	lt,
	ne,
	or,
} from "drizzle-orm";
import type { HostDb } from "../db";
import { terminalAgentBindings, terminalSessions } from "../db/schema";
import type {
	TerminalAgentBindingListFilter,
	TerminalAgentBindingPersistence,
} from "./store";
import type { TerminalAgentBinding, TerminalAgentId } from "./types";

/** How long an exited terminal's binding stays around as a resume breadcrumb. */
export const EXITED_BINDING_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

const bindingColumns = {
	terminalId: terminalAgentBindings.terminalId,
	workspaceId: terminalAgentBindings.workspaceId,
	agentId: terminalAgentBindings.agentId,
	agentSessionId: terminalAgentBindings.agentSessionId,
	definitionId: terminalAgentBindings.definitionId,
	startedAt: terminalAgentBindings.startedAt,
	lastEventAt: terminalAgentBindings.lastEventAt,
	lastEventType: terminalAgentBindings.lastEventType,
};

interface BindingRow {
	terminalId: string;
	workspaceId: string;
	agentId: TerminalAgentId;
	agentSessionId: string | null;
	definitionId: AgentDefinitionId | null;
	startedAt: number;
	lastEventAt: number;
	lastEventType: string;
}

function rowToBinding(row: BindingRow): TerminalAgentBinding {
	return {
		terminalId: row.terminalId,
		workspaceId: row.workspaceId,
		agentId: row.agentId,
		...(row.agentSessionId ? { agentSessionId: row.agentSessionId } : {}),
		...(row.definitionId ? { definitionId: row.definitionId } : {}),
		startedAt: row.startedAt,
		lastEventAt: row.lastEventAt,
		lastEventType: row.lastEventType,
	};
}

export class SqliteTerminalAgentBindingPersistence
	implements TerminalAgentBindingPersistence
{
	constructor(private readonly db: HostDb) {}

	load(): TerminalAgentBinding[] {
		const rows = this.db
			.select(bindingColumns)
			.from(terminalAgentBindings)
			.innerJoin(
				terminalSessions,
				eq(terminalAgentBindings.terminalId, terminalSessions.id),
			)
			.where(ne(terminalSessions.status, "disposed"))
			.all();

		return rows.map(rowToBinding);
	}

	/**
	 * Bindings whose terminal session is still `active` and workspace-owned.
	 * Liveness comes from `terminal_sessions.status` — the source already
	 * maintained by pty onExit, the dispose routes, and the reaper's orphan
	 * healing — so a dead terminal's agent is unrepresentable in reads no
	 * matter how the terminal died (kill -9, crash, host downtime).
	 */
	listLiveByWorkspace(
		workspaceId: string,
		filter?: TerminalAgentBindingListFilter,
	): TerminalAgentBinding[] {
		const rows = this.db
			.select(bindingColumns)
			.from(terminalAgentBindings)
			.innerJoin(
				terminalSessions,
				eq(terminalAgentBindings.terminalId, terminalSessions.id),
			)
			.where(
				and(
					eq(terminalAgentBindings.workspaceId, workspaceId),
					eq(terminalSessions.status, "active"),
					isNotNull(terminalSessions.originWorkspaceId),
					...(filter?.agentId
						? [eq(terminalAgentBindings.agentId, filter.agentId)]
						: []),
					...(filter?.definitionId
						? [eq(terminalAgentBindings.definitionId, filter.definitionId)]
						: []),
				),
			)
			.all();

		return rows.map(rowToBinding);
	}

	listLive(): TerminalAgentBinding[] {
		const rows = this.db
			.select(bindingColumns)
			.from(terminalAgentBindings)
			.innerJoin(
				terminalSessions,
				eq(terminalAgentBindings.terminalId, terminalSessions.id),
			)
			.where(
				and(
					eq(terminalSessions.status, "active"),
					isNotNull(terminalSessions.originWorkspaceId),
				),
			)
			.all();

		return rows.map(rowToBinding);
	}

	findLiveActive(
		workspaceId: string,
		agentId: TerminalAgentId,
		definitionId?: AgentDefinitionId,
	): TerminalAgentBinding | undefined {
		const rows = this.db
			.select(bindingColumns)
			.from(terminalAgentBindings)
			.innerJoin(
				terminalSessions,
				eq(terminalAgentBindings.terminalId, terminalSessions.id),
			)
			.where(
				and(
					eq(terminalAgentBindings.workspaceId, workspaceId),
					eq(terminalAgentBindings.agentId, agentId),
					eq(terminalSessions.status, "active"),
					isNotNull(terminalSessions.originWorkspaceId),
					...(definitionId
						? [eq(terminalAgentBindings.definitionId, definitionId)]
						: []),
				),
			)
			.orderBy(desc(terminalAgentBindings.lastEventAt))
			.limit(1)
			.all();

		const row = rows[0];
		return row ? rowToBinding(row) : undefined;
	}

	/**
	 * Best-effort hygiene: drop binding rows whose session is missing,
	 * `disposed`, workspace-less, or long-`exited`. Reads already hide all of
	 * these via the live join; this only keeps the table small, so callers may
	 * swallow failures.
	 *
	 * Recently-exited bindings are deliberately KEPT: they are the breadcrumbs
	 * the lost-pty respawn path uses to auto-resume an agent whose terminal
	 * died without exit hooks (machine reboot, daemon crash). They age out
	 * after {@link EXITED_BINDING_RETENTION_MS}.
	 */
	deleteDefunct(): void {
		const exitedCutoff = Date.now() - EXITED_BINDING_RETENTION_MS;
		const rows = this.db
			.select({ terminalId: terminalAgentBindings.terminalId })
			.from(terminalAgentBindings)
			.leftJoin(
				terminalSessions,
				eq(terminalAgentBindings.terminalId, terminalSessions.id),
			)
			.where(
				or(
					isNull(terminalSessions.id),
					eq(terminalSessions.status, "disposed"),
					isNull(terminalSessions.originWorkspaceId),
					and(
						eq(terminalSessions.status, "exited"),
						or(
							isNull(terminalSessions.endedAt),
							lt(terminalSessions.endedAt, exitedCutoff),
						),
					),
				),
			)
			.all();
		if (rows.length === 0) return;

		this.db
			.delete(terminalAgentBindings)
			.where(
				inArray(
					terminalAgentBindings.terminalId,
					rows.map((row) => row.terminalId),
				),
			)
			.run();
	}

	upsert(binding: TerminalAgentBinding): void {
		this.db
			.insert(terminalAgentBindings)
			.values({
				terminalId: binding.terminalId,
				workspaceId: binding.workspaceId,
				agentId: binding.agentId,
				agentSessionId: binding.agentSessionId ?? null,
				definitionId: binding.definitionId ?? null,
				startedAt: binding.startedAt,
				lastEventAt: binding.lastEventAt,
				lastEventType: binding.lastEventType,
			})
			.onConflictDoUpdate({
				target: terminalAgentBindings.terminalId,
				set: {
					workspaceId: binding.workspaceId,
					agentId: binding.agentId,
					agentSessionId: binding.agentSessionId ?? null,
					definitionId: binding.definitionId ?? null,
					startedAt: binding.startedAt,
					lastEventAt: binding.lastEventAt,
					lastEventType: binding.lastEventType,
				},
			})
			.run();
	}

	delete(terminalId: string): void {
		this.db
			.delete(terminalAgentBindings)
			.where(eq(terminalAgentBindings.terminalId, terminalId))
			.run();
	}
}
