import { observable } from "@trpc/server/observable";
import {
	buildStatusDirectory,
	dismissBuild,
	observeBuildJobs,
} from "main/lib/build-status/store";
import { type BuildJob, buildIdSchema } from "shared/build-status";
import { z } from "zod";
import { publicProcedure, router } from "../..";

export const createBuildStatusRouter = () =>
	router({
		subscribe: publicProcedure.subscription(() =>
			observable<BuildJob[]>((emit) =>
				observeBuildJobs(buildStatusDirectory(), (jobs) => emit.next(jobs)),
			),
		),
		dismiss: publicProcedure
			.input(z.object({ id: buildIdSchema, revision: z.string().max(80) }))
			.mutation(({ input }) => {
				dismissBuild(buildStatusDirectory(), input.id, input.revision);
			}),
	});
