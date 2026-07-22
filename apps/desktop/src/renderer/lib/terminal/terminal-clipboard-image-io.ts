import { electronTrpcClient } from "renderer/lib/trpc-client";
import type { SaveClipboardImage } from "./terminal-image-paste";

/**
 * Concrete {@link SaveClipboardImage}: hands the pasted image bytes to the main
 * process, which writes a temp file and returns its absolute path. Kept out of
 * `terminal-image-paste.ts` so that module has no Electron/tRPC dependency.
 */
export const saveClipboardImageToTemp: SaveClipboardImage = async (payload) => {
	const { path } =
		await electronTrpcClient.external.saveTerminalImage.mutate(payload);
	return path;
};
