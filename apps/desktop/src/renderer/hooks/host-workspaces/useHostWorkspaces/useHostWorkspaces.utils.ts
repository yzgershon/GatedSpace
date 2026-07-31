import type { SelectV2Workspace } from "@superset/db/schema";
import { buildHostRoutingKey } from "@superset/shared/host-routing";
import type { WorkspaceSnapshotPayload } from "@superset/workspace-client";
import { del as idbDel, get as idbGet, set as idbSet } from "idb-keyval";

/**
 * A workspace row as served by a host (`workspace.list`) — the cloud row
 * shape plus the host-only extras.
 */
export interface HostWorkspaceRow extends SelectV2Workspace {
	worktreePath: string;
	worktreeExists: boolean;
}

/** Merged item returned by useHostWorkspaces. */
export interface HostWorkspaceItem extends SelectV2Workspace {
	worktreePath?: string;
	worktreeExists?: boolean;
	/** False when the row came from a snapshot/cloud and the host didn't answer. */
	hostReachable: boolean;
	/** "host" = served by a host (live or last-seen); "cloud" = Electric fallback. */
	source: "host" | "cloud";
}

export interface HostWorkspacesQueryTarget {
	machineId: string;
	organizationId: string;
	/** Null when the host is known but unreachable (offline remote). */
	hostUrl: string | null;
	isLocal: boolean;
}

export interface HostRowForTargets {
	organizationId: string;
	machineId: string;
	isOnline: boolean;
}

export function getHostWorkspacesQueryKey(
	target: Pick<HostWorkspacesQueryTarget, "machineId" | "hostUrl">,
) {
	return [
		"host-service",
		"workspaces",
		"list",
		target.machineId,
		target.hostUrl,
	] as const;
}

/**
 * One target per known host: the local host always (direct URL), remote
 * hosts via relay when online, and a null-URL placeholder when offline so
 * the last-seen snapshot still renders.
 */
export function deriveHostWorkspacesQueryTargets({
	activeHostUrl,
	hosts,
	machineId,
	relayUrl,
}: {
	activeHostUrl: string | null;
	hosts: HostRowForTargets[];
	machineId: string | null;
	relayUrl: string;
}): HostWorkspacesQueryTarget[] {
	const targets: HostWorkspacesQueryTarget[] = hosts.map((host) => {
		const isLocal = host.machineId === machineId;
		const hostUrl = isLocal
			? activeHostUrl
			: host.isOnline
				? `${relayUrl}/hosts/${buildHostRoutingKey(host.organizationId, host.machineId)}`
				: null;
		return {
			machineId: host.machineId,
			organizationId: host.organizationId,
			hostUrl,
			isLocal,
		};
	});

	// The local host may not have a v2_hosts row yet (fresh install, stale
	// Electric); it is still queryable directly.
	if (
		machineId &&
		activeHostUrl &&
		!targets.some((target) => target.machineId === machineId)
	) {
		targets.push({
			machineId,
			organizationId: hosts[0]?.organizationId ?? "",
			hostUrl: activeHostUrl,
			isLocal: true,
		});
	}

	return targets;
}

/**
 * Whether the workspace read path has finished finding out what exists.
 *
 * The subtlety that makes this its own function: `[].every()` is `true`. Asking
 * "did every host query settle" while NO host has been discovered yet answers
 * "yes" — so on a cold start, for the whole second or two before the local
 * host service publishes its port, the merged list is empty AND claims to be
 * complete. Anything gated on this reads that as "it isn't there": the restored
 * workspace route rendered "Workspace not found" on every launch, then
 * corrected itself once the real rows arrived.
 *
 * So readiness has two halves, and both have to hold:
 *  - discovery: we have a local host URL, or the attempt to get one has
 *    finished. While it is still coming there is nothing to be ready about.
 *  - settlement: every discovered host answered, failed, or served a snapshot.
 *
 * `hostServiceSettled` rather than the coordinator's process status, which was
 * the first attempt at this and did not work. `getProcessStatus` reports
 * "stopped" for a service that has never been asked to start as well as for one
 * that failed — identical values, opposite meanings — and at launch the first
 * one is always true. So the flash survived the fix that was supposed to remove
 * it. Only the caller that owns the start attempt knows whether it has been
 * made, which is why that answer is passed in rather than derived here.
 *
 * A failed start still counts as settled: we tried, it did not work, and the
 * honest thing is to show the real state plus the error the provider raises.
 * A spinner that never resolves would be worse than a wrong answer shown fast.
 */
export function isHostWorkspacesReady({
	targetsSettled,
	activeHostUrl,
	hostServiceSettled,
}: {
	/** Result of the per-host query settlement check. */
	targetsSettled: boolean;
	activeHostUrl: string | null;
	/** A start attempt for the local host service has succeeded or failed. */
	hostServiceSettled: boolean;
}): boolean {
	const localHostPending = activeHostUrl === null && !hostServiceSettled;
	if (localHostPending) return false;
	return targetsSettled;
}

const SNAPSHOT_KEY_PREFIX = "host-workspaces:v1";

function snapshotKey(organizationId: string, machineId: string): string {
	return `${SNAPSHOT_KEY_PREFIX}:${organizationId}:${machineId}`;
}

/**
 * Last-seen per-host snapshots in IndexedDB. Dates survive the structured
 * clone, so rows round-trip as-is. Only affects offline visibility of
 * remote hosts — the local host answers live even offline. Persistence
 * failures are deliberately swallowed: the snapshot is a best-effort cache
 * and every failure mode degrades to "fetch live next time".
 */
export async function loadHostWorkspacesSnapshot(
	organizationId: string,
	machineId: string,
): Promise<HostWorkspaceRow[] | undefined> {
	if (!organizationId) return undefined;
	try {
		return await idbGet<HostWorkspaceRow[]>(
			snapshotKey(organizationId, machineId),
		);
	} catch {
		return undefined;
	}
}

export function saveHostWorkspacesSnapshot(
	organizationId: string,
	machineId: string,
	rows: HostWorkspaceRow[],
): void {
	if (!organizationId) return;
	void idbSet(snapshotKey(organizationId, machineId), rows).catch(() => {});
}

export function clearHostWorkspacesSnapshot(
	organizationId: string,
	machineId: string,
): void {
	if (!organizationId) return;
	void idbDel(snapshotKey(organizationId, machineId)).catch(() => {});
}

/**
 * Apply a workspace:changed event to a host's cached list. Created/updated
 * upsert from the event's snapshot payload; deleted removes the row.
 */
export function applyWorkspaceChangedEvent(
	rows: HostWorkspaceRow[] | undefined,
	event: {
		eventType: "created" | "updated" | "deleted";
		workspace: WorkspaceSnapshotPayload | null;
	},
	host: { organizationId: string; machineId: string },
	workspaceId: string,
): HostWorkspaceRow[] | undefined {
	if (event.eventType === "deleted") {
		if (!rows) return rows;
		const next = rows.filter((row) => row.id !== workspaceId);
		return next.length === rows.length ? rows : next;
	}
	const snapshot = event.workspace;
	if (!snapshot) return rows;
	const existing = rows?.find((row) => row.id === snapshot.id);
	const nextRow: HostWorkspaceRow = {
		id: snapshot.id,
		organizationId: host.organizationId,
		projectId: snapshot.projectId,
		hostId: host.machineId,
		name: snapshot.name,
		branch: snapshot.branch,
		type: snapshot.type,
		createdByUserId: snapshot.createdByUserId,
		taskId: snapshot.taskId,
		createdAt: new Date(snapshot.createdAt),
		updatedAt: new Date(snapshot.updatedAt),
		worktreePath: snapshot.worktreePath,
		// A host broadcasting created/updated just acted on the worktree;
		// keep a known value over assuming.
		worktreeExists: existing?.worktreeExists ?? true,
	};
	if (!rows) return [nextRow];
	return existing
		? rows.map((row) => (row.id === nextRow.id ? nextRow : row))
		: [...rows, nextRow];
}

/**
 * Merge per-host results (live or last-seen) with the Electric fallback.
 * A host that answered is authoritative for its rows — cloud rows for that
 * host are ignored (a deleted row must not resurrect). Cloud rows only fill
 * in for hosts with no host-served data (pre-R1 builds, no snapshot yet).
 * The fallback is deleted in R3 along with the cloud table.
 */
export function mergeHostWorkspaces({
	hostResults,
	cloudRows,
}: {
	hostResults: Array<{
		target: HostWorkspacesQueryTarget;
		rows: HostWorkspaceRow[] | undefined;
		reachable: boolean;
	}>;
	cloudRows: SelectV2Workspace[];
}): HostWorkspaceItem[] {
	const items: HostWorkspaceItem[] = [];
	const hostsWithData = new Set<string>();
	const seenIds = new Set<string>();

	for (const result of hostResults) {
		if (!result.rows) continue;
		hostsWithData.add(result.target.machineId);
		for (const row of result.rows) {
			if (seenIds.has(row.id)) continue;
			seenIds.add(row.id);
			items.push({
				...row,
				hostReachable: result.reachable,
				source: "host",
			});
		}
	}

	for (const row of cloudRows) {
		if (seenIds.has(row.id) || hostsWithData.has(row.hostId)) continue;
		seenIds.add(row.id);
		items.push({
			...row,
			hostReachable: false,
			source: "cloud",
		});
	}

	return items;
}
