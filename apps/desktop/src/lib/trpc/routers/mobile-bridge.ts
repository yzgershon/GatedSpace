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
			.mutation(({ input }) =>
				mobileBridge.start(input.mode as BridgeBindingMode),
			),
		stop: publicProcedure.mutation(() => mobileBridge.stop()),
	});
};
