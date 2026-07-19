import type {
	SelectOrganization,
	SelectUser,
	SelectV2Host,
	SelectV2Project,
	SelectV2UsersHosts,
} from "@superset/db/schema";
import type { Collection } from "@tanstack/react-db";
import { useEffect } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { LOCAL_ORG_ID, LOCAL_USER_ID } from "renderer/lib/local-mode";
import { useCollections } from "../CollectionsProvider";
import { useLocalHostService } from "../LocalHostServiceProvider";

const PROJECT_MIRROR_INTERVAL_MS = 5_000;

/**
 * Local-only mode data plane: the cloud collections are in-memory local-only
 * stores (see collections.ts), so this component seeds the rows the workspace
 * join path needs — the fixed local org + user, this machine as an online
 * host the local user can access, and a live mirror of the host-service's
 * project list into v2Projects. host.db stays authoritative; these rows are
 * derived state rebuilt on every boot.
 *
 * Mounted only in local mode, inside LocalHostServiceProvider.
 */
export function LocalModeSeeder() {
	const collections = useCollections();
	const { activeHostUrl, machineId } = useLocalHostService();
	const { data: hostInfo } = electronTrpc.device.getHostInfo.useQuery(
		undefined,
		{ staleTime: Number.POSITIVE_INFINITY },
	);

	// Static rows: org, user, this machine as a host + host access.
	useEffect(() => {
		const now = new Date();

		upsert<SelectOrganization>(collections.organizations, LOCAL_ORG_ID, {
			id: LOCAL_ORG_ID,
			name: "Local",
			slug: "local",
			logo: null,
			createdAt: now,
			metadata: null,
			stripeCustomerId: null,
			allowedDomains: [],
		});

		upsert<SelectUser>(collections.users, LOCAL_USER_ID, {
			id: LOCAL_USER_ID,
			name: "Local",
			email: "local@gatedspace.local",
			emailVerified: true,
			image: null,
			organizationIds: [LOCAL_ORG_ID],
			onboardedAt: now,
			createdAt: now,
			updatedAt: now,
		});

		upsert<SelectV2Host>(collections.v2Hosts, machineId, {
			organizationId: LOCAL_ORG_ID,
			machineId,
			name: hostInfo?.hostName ?? "This computer",
			isOnline: true,
			wakeCommand: null,
			createdByUserId: LOCAL_USER_ID,
			createdAt: now,
			updatedAt: now,
		});

		upsert<SelectV2UsersHosts>(
			collections.v2UsersHosts,
			`${LOCAL_USER_ID}:${machineId}`,
			{
				organizationId: LOCAL_ORG_ID,
				userId: LOCAL_USER_ID,
				hostId: machineId,
				role: "owner",
				createdAt: now,
				updatedAt: now,
			},
		);
	}, [collections, machineId, hostInfo?.hostName]);

	// Mirror the host-service's project list into v2Projects so the workspace
	// join (useAccessibleV2Workspaces) and project pickers resolve.
	useEffect(() => {
		if (!activeHostUrl) return;
		let cancelled = false;

		const mirror = async () => {
			try {
				const client = getHostServiceClientByUrl(activeHostUrl);
				const projects = await client.project.list.query();
				if (cancelled) return;
				const now = new Date();
				for (const project of projects) {
					const name =
						project.name ?? project.repoName ?? basename(project.repoPath);
					upsert<SelectV2Project>(collections.v2Projects, project.id, {
						id: project.id,
						organizationId: LOCAL_ORG_ID,
						name,
						slug: project.id,
						repoCloneUrl: project.repoUrl ?? null,
						githubRepositoryId: null,
						iconUrl: null,
						createdAt: now,
						updatedAt: now,
					});
				}
				// Projects deleted on the host disappear from the mirror too.
				const liveIds = new Set(projects.map((project) => project.id));
				for (const key of collections.v2Projects.keys()) {
					if (!liveIds.has(String(key))) {
						collections.v2Projects.delete(key);
					}
				}
			} catch (error) {
				console.warn("[local-mode-seeder] project mirror failed", error);
			}
		};

		void mirror();
		const interval = setInterval(
			() => void mirror(),
			PROJECT_MIRROR_INTERVAL_MS,
		);
		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, [collections, activeHostUrl]);

	return null;
}

function basename(path: string): string {
	const normalized = path.replace(/[\\/]+$/, "");
	const index = Math.max(
		normalized.lastIndexOf("/"),
		normalized.lastIndexOf("\\"),
	);
	return index === -1 ? normalized : normalized.slice(index + 1);
}

function upsert<T extends object>(
	// biome-ignore lint/suspicious/noExplicitAny: shared helper across differently-typed collections
	collection: Collection<T, any, any, any, any>,
	key: string,
	row: T,
) {
	if (collection.has(key)) {
		collection.update(key, (draft) => {
			Object.assign(draft as object, row);
		});
	} else {
		collection.insert(row);
	}
}
