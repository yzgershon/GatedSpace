import { useNavigate } from "@tanstack/react-router";
import { EnsembleWorkspace } from "renderer/components/EnsembleWorkspace/EnsembleWorkspace";
import { openEnsembleSession } from "renderer/components/EnsembleWorkspace/open-ensemble-session";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import { useFlockNavigation } from "./flock-navigation";

export function EnsemblePanel({ active = true }: { active?: boolean }) {
	const collections = useCollections();
	const navigate = useNavigate();
	const flock = useFlockNavigation();
	const snapshot = electronTrpc.ensemble.snapshot.useQuery(undefined, {
		enabled: active,
		refetchInterval: active ? 5000 : false,
	});
	const workspaces = electronTrpc.ensemble.workspaces.useQuery(undefined, {
		enabled: active,
	});
	electronTrpc.ensemble.stream.useSubscription(undefined, {
		enabled: active,
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
			<div className="flex flex-1 min-w-0 flex-col items-center justify-center gap-3 p-8 select-text cursor-text">
				<p role={snapshot.error ? "alert" : "status"}>
					{snapshot.error
						? `Couldn't open Flock: ${snapshot.error.message}`
						: "Opening Flock…"}
				</p>
				{snapshot.error && (
					<button
						type="button"
						className="rounded-md border px-3 py-2"
						onClick={() => void snapshot.refetch()}
					>
						Try again
					</button>
				)}
			</div>
		);
	return (
		<EnsembleWorkspace
			onClose={() => void flock.hide()}
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
						search: {},
					});
				},
			}}
		/>
	);
}
