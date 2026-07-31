import { toast } from "@superset/ui/sonner";
import { useLiveQuery } from "@tanstack/react-db";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { env } from "renderer/env.renderer";
import { authClient } from "renderer/lib/auth-client";
import { electronTrpc } from "renderer/lib/electron-trpc";
import {
	setClientMachineId,
	setHostServiceSecret,
} from "renderer/lib/host-service-auth";
import type { HostServiceAvailabilityStatus } from "renderer/lib/host-service-unavailable";
import { isLocalMode, LOCAL_ORG_ID } from "renderer/lib/local-mode";
import { markStartupOnce } from "renderer/lib/startup-mark";
import { MOCK_ORG_ID } from "shared/constants";
import { useCollections } from "../CollectionsProvider";

interface LocalHostServiceContextValue {
	machineId: string;
	activeHostUrl: string | null;
	activeOrganizationId: string | null;
	activeOrganizationName: string | null;
	hostServiceStatus: HostServiceAvailabilityStatus;
	/**
	 * A start attempt for the active org has finished, succeeded or failed.
	 *
	 * The thing to gate "there is nothing here" states on. Distinct from
	 * `hostServiceStatus`, which cannot tell "never asked" from "gave up".
	 */
	hostServiceSettled: boolean;
}

const LocalHostServiceContext =
	createContext<LocalHostServiceContextValue | null>(null);

export function LocalHostServiceProvider({
	children,
}: {
	children: ReactNode;
}) {
	const { data: session } = authClient.useSession();
	const collections = useCollections();
	const trpcUtils = electronTrpc.useUtils();

	/**
	 * Orgs whose start attempt has finished, one way or the other.
	 *
	 * This is the "have we actually tried yet" signal, and it has to come from
	 * here because the coordinator cannot provide it: `getProcessStatus` reports
	 * "stopped" both for a service that failed AND for one that has never been
	 * asked to start. Those look identical from outside and mean opposite things.
	 * Treating the second as a final answer is what kept "Workspace not found"
	 * flashing on every launch — the app concluded there was nothing to find
	 * before it had gone looking.
	 */
	const [settledOrgIds, setSettledOrgIds] = useState<ReadonlySet<string>>(
		() => new Set(),
	);

	const { mutate: startHostService } =
		electronTrpc.hostServiceCoordinator.start.useMutation({
			onSuccess: (connection, variables) => {
				// `start` RESOLVES WITH the live connection, so there is nothing left
				// to discover — seed the cache instead of polling for what we already
				// hold. The port is usable from this moment.
				trpcUtils.hostServiceCoordinator.getConnection.setData(
					{ organizationId: variables.organizationId },
					connection,
				);
			},
			onError: (error) => {
				// Surface the failure — React Query otherwise settles it silently.
				console.error("[host-service] start failed:", error);
				// Auth preconditions resolve once the token lands; not a real failure.
				if (error.data?.code === "UNAUTHORIZED") return;
				toast.error("Host service failed to start", {
					description: error.message,
				});
			},
			onSettled: (_data, _error, variables) => {
				setSettledOrgIds((previous) =>
					previous.has(variables.organizationId)
						? previous
						: new Set(previous).add(variables.organizationId),
				);
			},
		});

	const activeOrganizationId = env.SKIP_ENV_VALIDATION
		? MOCK_ORG_ID
		: (session?.session?.activeOrganizationId ?? null);

	const { data: organizations } = useLiveQuery(
		(q) => q.from({ organizations: collections.organizations }),
		[collections],
	);

	const organizationIds = useMemo(() => {
		// Local mode: no cloud org collection to iterate — start the host
		// service for the fixed local org directly.
		if (isLocalMode()) return [LOCAL_ORG_ID];
		return organizations?.map((organization) => organization.id) ?? [];
	}, [organizations]);

	useEffect(() => {
		for (const organizationId of organizationIds) {
			startHostService({ organizationId });
		}
	}, [organizationIds, startHostService]);

	const { data: machineIdData } = electronTrpc.device.getMachineId.useQuery(
		undefined,
		{ staleTime: Number.POSITIVE_INFINITY },
	);

	useEffect(() => {
		if (machineIdData?.machineId) {
			setClientMachineId(machineIdData.machineId);
		}
	}, [machineIdData]);

	/**
	 * The host service's port, which everything else waits on.
	 *
	 * The interval is short until we have it and slow afterwards. It used to be
	 * a flat 5s, which meant the port could be live at 800ms and the app would
	 * not find out until 5s — the single biggest chunk of a cold launch, spent
	 * entirely on a sleeping timer. Once connected, 5s is plenty: this is just
	 * a safety net behind the subscription below.
	 */
	const { data: activeConnection } =
		electronTrpc.hostServiceCoordinator.getConnection.useQuery(
			{ organizationId: activeOrganizationId as string },
			{
				enabled: !!activeOrganizationId,
				refetchInterval: (query) => (query.state.data?.port ? 5_000 : 250),
			},
		);

	/**
	 * The coordinator already announces "running" the moment the port passes its
	 * health check, so ask again on that edge rather than waiting for a tick.
	 *
	 * The poll above still matters: `start` can finish before this subscription
	 * is established, and a missed edge would otherwise mean waiting for the
	 * slow interval. Belt and braces on the path that decides how fast the app
	 * opens.
	 */
	electronTrpc.hostServiceCoordinator.onStatusChange.useSubscription(
		undefined,
		{
			onData: (event) => {
				if (event.organizationId !== activeOrganizationId) return;
				void trpcUtils.hostServiceCoordinator.getConnection.invalidate({
					organizationId: event.organizationId,
				});
				void trpcUtils.hostServiceCoordinator.getProcessStatus.invalidate({
					organizationId: event.organizationId,
				});
			},
		},
	);

	const { data: processStatus } =
		electronTrpc.hostServiceCoordinator.getProcessStatus.useQuery(
			{ organizationId: activeOrganizationId as string },
			{
				enabled: !!activeOrganizationId,
				refetchInterval: activeConnection?.port ? false : 1_000,
			},
		);

	/**
	 * The moment the app becomes usable, from the renderer's point of view.
	 *
	 * Logged once, not on every change: this is the number to watch when tuning
	 * launch, and it is the renderer half of main's `[startup]` lines — together
	 * they cover the whole wait the user actually sits through.
	 */
	const connectionPort = activeConnection?.port ?? null;
	useEffect(() => {
		markStartupOnce("host service provider mounted");
	}, []);
	useEffect(() => {
		if (connectionPort == null) return;
		markStartupOnce(`host service reachable on port ${connectionPort}`);
	}, [connectionPort]);

	const activeOrganizationName = useMemo(() => {
		const name =
			organizations?.find(
				(organization) => organization.id === activeOrganizationId,
			)?.name ?? null;
		if (name == null && isLocalMode()) return "Local";
		return name;
	}, [organizations, activeOrganizationId]);

	const hostServiceSettled = activeOrganizationId
		? settledOrgIds.has(activeOrganizationId)
		: false;

	const value = useMemo<LocalHostServiceContextValue | null>(() => {
		if (!machineIdData) return null;
		const machineId = machineIdData.machineId;
		const hostServiceStatus: HostServiceAvailabilityStatus =
			activeConnection?.port != null
				? "running"
				: (processStatus?.status ?? "unknown");

		if (!activeConnection?.port) {
			return {
				machineId,
				activeHostUrl: null,
				activeOrganizationId: activeOrganizationId ?? null,
				activeOrganizationName,
				hostServiceStatus,
				hostServiceSettled,
			};
		}

		const activeHostUrl = `http://127.0.0.1:${activeConnection.port}`;
		if (activeConnection.secret) {
			setHostServiceSecret(activeHostUrl, activeConnection.secret);
		}

		return {
			machineId,
			activeHostUrl,
			activeOrganizationId: activeOrganizationId ?? null,
			activeOrganizationName,
			hostServiceStatus,
			hostServiceSettled,
		};
	}, [
		machineIdData,
		activeConnection,
		activeOrganizationId,
		activeOrganizationName,
		processStatus?.status,
		hostServiceSettled,
	]);

	if (!value) return null;

	return (
		<LocalHostServiceContext.Provider value={value}>
			{children}
		</LocalHostServiceContext.Provider>
	);
}

export function useLocalHostService(): LocalHostServiceContextValue {
	const context = useContext(LocalHostServiceContext);
	if (!context) {
		throw new Error(
			"useLocalHostService must be used within LocalHostServiceProvider",
		);
	}
	return context;
}
