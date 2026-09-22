import { useQueries } from "@tanstack/react-query";
import { getHostServiceClientByUrl } from "renderer/lib/host-service-client";
import { useHostWorkspaces } from "renderer/routes/_authenticated/providers/HostWorkspacesProvider";
import { useLocalHostService } from "renderer/routes/_authenticated/providers/LocalHostServiceProvider";

export const hostProjectMetadataKey = (url: string) =>
	["host-project-metadata", url] as const;

/** Local project names remain available when cloud metadata is absent. */
export function useHostProjects() {
	const { activeHostUrl } = useLocalHostService();
	const { workspaces, cache } = useHostWorkspaces();
	const urls = [
		...new Set(
			[
				activeHostUrl,
				...workspaces.map((workspace) =>
					cache.resolveHostUrl(workspace.hostId),
				),
			].filter((url): url is string => Boolean(url)),
		),
	];
	const queries = useQueries({
		queries: urls.map((url) => ({
			queryKey: hostProjectMetadataKey(url),
			queryFn: () => getHostServiceClientByUrl(url).project.list.query(),
			staleTime: 30_000,
			refetchInterval: 30_000,
		})),
	});
	return queries.flatMap((query, index) =>
		(query.data ?? []).map((project) => ({ ...project, hostUrl: urls[index] })),
	);
}
