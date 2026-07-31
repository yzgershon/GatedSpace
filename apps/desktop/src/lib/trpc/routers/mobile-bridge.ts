/**
 * Turning the phone bridge on and off, and showing the link to open on it.
 *
 * Start and stop are mutations rather than a single toggle so the UI can report
 * WHY a start failed — "no network in that mode" needs saying, not a switch
 * that silently springs back.
 */
import {
	BRIDGE_BINDING_MODES,
	type BridgeBindingMode,
	DEFAULT_BRIDGE_BINDING_MODE,
} from "main/lib/mobile-bridge/binding";
import { writeBridgeState } from "main/lib/mobile-bridge/bridge-state";
import { mobileBridge } from "main/lib/mobile-bridge/server";
import { z } from "zod";
import { publicProcedure, router } from "..";

const modeSchema = z
	.enum(BRIDGE_BINDING_MODES as [string, ...string[]])
	.default(DEFAULT_BRIDGE_BINDING_MODE);

export const createMobileBridgeRouter = () => {
	return router({
		status: publicProcedure.query(() => mobileBridge.status()),
		start: publicProcedure
			.input(z.object({ mode: modeSchema }))
			.mutation(async ({ input }) => {
				const mode = input.mode as BridgeBindingMode;
				const status = await mobileBridge.start(mode);
				// Remembered only once it actually came up. Recording the intent of a
				// start that failed would have the app retry a broken mode on every
				// launch and report an error nobody asked for.
				if (status.running) writeBridgeState({ enabled: true, mode });
				return status;
			}),
		stop: publicProcedure.mutation(async () => {
			const status = await mobileBridge.stop();
			// The mode is kept so turning it back on offers the last one used.
			writeBridgeState({ enabled: false, mode: mobileBridge.lastMode() });
			return status;
		}),
	});
};
