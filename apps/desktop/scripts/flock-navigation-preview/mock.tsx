import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

// Only transport and unavailable desktop services are simulated. Navigation,
// data/loading/error handling, Flock, and dashboard view lifetimes are real.
export const probe = {
	workspaceMounts: 0,
	workspaceUnmounts: 0,
	activeStreams: 0,
	requests: 0,
	shortcutInvocations: 0,
	mode: "ready" as "ready" | "pending" | "error" | "crash",
};
export const snapshot = { groups: [], sessions: [] };
export const electronTrpc = {
	ensemble: {
		snapshot: {
			useQuery: (_input: unknown, options: object) =>
				useQuery({
					queryKey: ["flock-snapshot"],
					queryFn: async () => {
						probe.requests++;
						if (probe.mode === "pending") await new Promise(() => {});
						if (probe.mode === "error")
							throw new Error("Test connection unavailable");
						if (probe.mode === "crash") return { groups: null, sessions: [] };
						return snapshot;
					},
					...options,
				}),
		},
		workspaces: {
			useQuery: () => ({
				data: [{ id: "current", name: "Local", project: "Example" }],
			}),
		},
		stream: {
			useSubscription: (_input: unknown, options: { enabled: boolean }) => {
				useEffect(() => {
					if (!options.enabled) return;
					probe.activeStreams++;
					return () => {
						probe.activeStreams--;
					};
				}, [options.enabled]);
			},
		},
	},
};
export const electronTrpcClient = {
	ensemble: {},
	keyboardLayout: { changes: { subscribe: () => ({ unsubscribe() {} }) } },
};
export const useCollections = () => ({});
export const openEnsembleSession = () => "current";
export const UsageDialog = () => null;
