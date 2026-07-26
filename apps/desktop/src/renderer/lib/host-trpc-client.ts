/**
 * A plain tRPC client for the local host service, usable OUTSIDE a workspace.
 *
 * Everything that talks to the host normally does so through
 * `WorkspaceClientProvider`, which is mounted per workspace. The sidebar rail
 * isn't inside one, and it needs a single host query: which sessions a terminal
 * currently holds. That answer decides whether clicking a session RESUMES it or
 * FORKS it, and getting it wrong is what silently destroyed a transcript twice.
 *
 * So this exists to ask that one question from the rail. It deliberately does
 * not become a second general-purpose client: same links and headers as the
 * provider's, cached per host URL so repeat calls don't rebuild it, and no
 * React context of its own.
 */

import { workspaceTrpc } from "@superset/workspace-client";
import { httpBatchStreamLink } from "@trpc/client";
import superjson from "superjson";
import { getHostServiceHeaders } from "./host-service-auth";

type HostClient = ReturnType<typeof workspaceTrpc.createClient>;

const clients = new Map<string, HostClient>();

/**
 * The client for a host URL, created once and reused. Null when there's no host
 * yet — during startup, or before any project has been opened — which callers
 * must treat as "unknown", never as "nothing is live".
 */
export function getHostTrpcClient(hostUrl: string | null): HostClient | null {
	if (!hostUrl) return null;
	const existing = clients.get(hostUrl);
	if (existing) return existing;

	const client = workspaceTrpc.createClient({
		links: [
			httpBatchStreamLink({
				url: `${hostUrl}/trpc`,
				transformer: superjson,
				headers: () => getHostServiceHeaders(hostUrl),
			}),
		],
	});
	clients.set(hostUrl, client);
	return client;
}
