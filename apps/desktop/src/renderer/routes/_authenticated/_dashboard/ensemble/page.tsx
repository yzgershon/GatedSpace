import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { EnsembleWorkspace } from "renderer/components/EnsembleWorkspace/EnsembleWorkspace";
import { openEnsembleSession } from "renderer/components/EnsembleWorkspace/open-ensemble-session";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";

export const Route = createFileRoute("/_authenticated/_dashboard/ensemble/")({
	component: EnsembleRoute,
});
function EnsembleRoute() {
	const collections = useCollections();
	const navigate = useNavigate();
	const snapshot = electronTrpc.ensemble.snapshot.useQuery(undefined, {
		refetchInterval: 5000,
	});
	const workspaces = electronTrpc.ensemble.workspaces.useQuery();
	electronTrpc.ensemble.stream.useSubscription(undefined, {
		onData: () => {
			void snapshot.refetch();
		},
	});
	const api = electronTrpcClient.ensemble;
	const mutate = async <T,>(fn: () => Promise<T>) => {
		const result = await fn();
		await snapshot.refetch();
		return result;
	};
	if (!snapshot.data)
		return (
			<div className="p-8 select-text cursor-text">
				{snapshot.error ? snapshot.error.message : "Opening Flock…"}
			</div>
		);
	return (
		<EnsembleWorkspace
			snapshot={snapshot.data}
			workspaces={workspaces.data ?? []}
			actions={{
				create: (input) => mutate(() => api.create.mutate(input)),
				control: (id, action) =>
					mutate(() => api.control.mutate({ id, action })),
				message: (id, to, text) =>
					mutate(() => api.message.mutate({ id, to, text })),
				update: (id, input) =>
					mutate(() => api.update.mutate({ id, ...input })),
				resolve: (id, messageId, retry) =>
					mutate(() => api.resolve.mutate({ id, messageId, retry })),
				addMember: (id, member) =>
					mutate(() => api.addMember.mutate({ id, member })),
				removeMember: (id, memberId) =>
					mutate(() => api.removeMember.mutate({ id, memberId })),
				createSession: (provider, workspaceId) =>
					mutate(() => api.createSession.mutate({ provider, workspaceId })),
				openSession: (member) => {
					const workspaceId = openEnsembleSession(collections, member);
					void navigate({
						to: "/v2-workspace/$workspaceId",
						params: { workspaceId },
					});
				},
			}}
		/>
	);
}
