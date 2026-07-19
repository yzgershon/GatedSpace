import { TRPCError } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { env } from "main/env.main";
import {
	getHostServiceCoordinator,
	type HostServiceStatusEvent,
} from "main/lib/host-service-coordinator";
import { isLocalOnlyBuild } from "main/lib/local-mode";
import { z } from "zod";
import { publicProcedure, router } from "../..";
import { loadToken } from "../auth/utils/auth-functions";

const orgInput = z.object({ organizationId: z.string() });

/**
 * Resolve the spawn config for a host-service child. A signed-in user's token
 * always wins; local-only builds fall back to a sentinel token and flag the
 * child to skip cloud calls. Cloud builds with no token still throw.
 */
async function resolveSpawnConfig() {
	const { token } = await loadToken();
	if (token) {
		return {
			authToken: token,
			cloudApiUrl: env.NEXT_PUBLIC_API_URL,
			localOnly: false,
		};
	}
	if (isLocalOnlyBuild()) {
		return {
			authToken: "local-only",
			cloudApiUrl: env.NEXT_PUBLIC_API_URL,
			localOnly: true,
		};
	}
	throw new TRPCError({
		code: "UNAUTHORIZED",
		message: "No auth token available — user must be logged in",
	});
}

export const createHostServiceCoordinatorRouter = () => {
	return router({
		start: publicProcedure.input(orgInput).mutation(async ({ input }) => {
			const coordinator = getHostServiceCoordinator();
			return coordinator.start(input.organizationId, await resolveSpawnConfig());
		}),

		getConnection: publicProcedure.input(orgInput).query(({ input }) => {
			const coordinator = getHostServiceCoordinator();
			return coordinator.getConnection(input.organizationId);
		}),

		getProcessStatus: publicProcedure.input(orgInput).query(({ input }) => {
			const coordinator = getHostServiceCoordinator();
			return { status: coordinator.getProcessStatus(input.organizationId) };
		}),

		restart: publicProcedure.input(orgInput).mutation(async ({ input }) => {
			const coordinator = getHostServiceCoordinator();
			return coordinator.restart(
				input.organizationId,
				await resolveSpawnConfig(),
			);
		}),

		reset: publicProcedure.input(orgInput).mutation(async ({ input }) => {
			const coordinator = getHostServiceCoordinator();
			return coordinator.reset(input.organizationId, await resolveSpawnConfig());
		}),

		onStatusChange: publicProcedure.subscription(() => {
			return observable<HostServiceStatusEvent>((emit) => {
				const coordinator = getHostServiceCoordinator();
				const handler = (event: HostServiceStatusEvent) => emit.next(event);
				coordinator.on("status-changed", handler);
				return () => coordinator.off("status-changed", handler);
			});
		}),
	});
};
