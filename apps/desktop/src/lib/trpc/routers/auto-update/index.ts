import { observable } from "@trpc/server/observable";
import {
	type AutoUpdateStatusEvent,
	autoUpdateEmitter,
	checkForUpdates,
	checkForUpdatesInteractive,
	dismissUpdate,
	getPersonalUpdate,
	getUpdateStatus,
	installAvailablePersonalUpdate,
	installUpdate,
	simulateDownloading,
	simulateError,
	simulateUpdateReady,
} from "main/lib/auto-updater";
import { z } from "zod";
import { publicProcedure, router } from "../..";

export const createAutoUpdateRouter = () => {
	return router({
		subscribe: publicProcedure.subscription(() => {
			return observable<AutoUpdateStatusEvent>((emit) => {
				emit.next(getUpdateStatus());

				const onStatusChanged = (event: AutoUpdateStatusEvent) => {
					emit.next(event);
				};

				autoUpdateEmitter.on("status-changed", onStatusChanged);

				return () => {
					autoUpdateEmitter.off("status-changed", onStatusChanged);
				};
			});
		}),

		getStatus: publicProcedure.query(() => {
			return getUpdateStatus();
		}),

		check: publicProcedure.mutation(() => {
			checkForUpdates();
		}),

		checkInteractive: publicProcedure.mutation(() => {
			return checkForUpdatesInteractive();
		}),

		install: publicProcedure.mutation(() => {
			return installUpdate();
		}),

		/*
		 * Personal builds only. Reports the newest installer in the configured
		 * release folder that is newer than what is running, or null. Returns
		 * null — never throws — when the feature is unconfigured, which is the
		 * normal state for a public build.
		 */
		checkPersonal: publicProcedure.query(() => {
			return getPersonalUpdate();
		}),

		installPersonal: publicProcedure
			.input(z.object({ installerPath: z.string().min(1) }))
			.mutation(({ input }) => {
				/*
				 * Re-derive the target rather than trusting the path off the wire.
				 * The renderer got it from `checkPersonal` moments ago, but this
				 * spawns an executable, so it verifies the path is still one this
				 * module would have offered before running it.
				 */
				return installAvailablePersonalUpdate(input.installerPath);
			}),

		dismiss: publicProcedure.mutation(() => {
			dismissUpdate();
		}),

		simulateReady: publicProcedure.mutation(() => {
			simulateUpdateReady();
		}),

		simulateDownloading: publicProcedure.mutation(() => {
			simulateDownloading();
		}),

		simulateError: publicProcedure.mutation(() => {
			simulateError();
		}),
	});
};
