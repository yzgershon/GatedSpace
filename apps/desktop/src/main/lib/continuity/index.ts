import { join } from "node:path";
import { SUPERSET_HOME_DIR } from "../app-environment";
import { SyncConnection } from "./connection";
import { SyncTransfers } from "./transfers";
import { SyncVault } from "./vault";

export const syncDirectory = join(SUPERSET_HOME_DIR, "continuity");
const vault = new SyncVault(syncDirectory, () => {
	// Keep Electron out of plain-Node host-service entry points.
	const electron = require("electron") as typeof import("electron");
	return electron.safeStorage;
});
export const syncConnection = new SyncConnection(vault);
export const syncTransfers = new SyncTransfers(syncConnection, vault);

let timer: ReturnType<typeof setInterval> | null = null;
/** No disk scanning or network requests until the user has paired and selected work. */
export function startSyncScheduler() {
	if (timer) return;
	timer = setInterval(() => {
		void syncTransfers.tick().catch(() => {});
	}, 60_000);
	timer.unref();
}
