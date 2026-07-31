import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
	ensureSupersetHomeDirExists,
	SUPERSET_HOME_DIR,
} from "../app-environment";
import { BRIDGE_BINDING_MODES, type BridgeBindingMode } from "./binding";

/**
 * Whether the phone bridge was left switched on, so it can come back by itself.
 *
 * It used to live only in memory, which meant the bridge was off after every
 * launch until someone opened Settings and toggled it. That is a small
 * annoyance at the desk and a genuine dead end away from it: the phone app
 * depends on the bridge, the bridge depends on the desktop app, and the only
 * way to turn it back on was the machine you are away from. Restarting
 * GatedSpace remotely — to install an update, say — cut off the phone until you
 * were physically back.
 *
 * The state is a file rather than the app database because the bridge starts
 * before any window exists and should not wait on the renderer to be told what
 * it was doing.
 */
const STATE_FILE = join(SUPERSET_HOME_DIR, "mobile-bridge.json");

export interface BridgeState {
	enabled: boolean;
	mode: BridgeBindingMode;
}

/**
 * On, over Tailscale HTTPS, unless told otherwise.
 *
 * The phone app is not a side feature here — it is the reason the bridge
 * exists — and an off-by-default switch means it is never there when it is
 * wanted, because the machine that could turn it on is the one you left.
 *
 * The exposure this creates is bounded by Tailscale rather than by this
 * default: `tailscale-serve` publishes to the tailnet only, and on a machine
 * with no Tailscale the start fails and the bridge simply does not come up.
 * The token is still required either way.
 */
export const BRIDGE_DEFAULT_STATE: BridgeState = {
	enabled: true,
	mode: "tailscale-serve",
};

function isMode(value: unknown): value is BridgeBindingMode {
	return (
		typeof value === "string" &&
		(BRIDGE_BINDING_MODES as readonly string[]).includes(value)
	);
}

export function readBridgeState(): BridgeState {
	try {
		const parsed: unknown = JSON.parse(readFileSync(STATE_FILE, "utf8"));
		if (parsed && typeof parsed === "object") {
			const record = parsed as Record<string, unknown>;
			return {
				// Only an explicit false turns it off. A file written by an older
				// build has no `enabled` key at all, and reading that as "off"
				// would silently disable the bridge on upgrade.
				enabled: record.enabled !== false,
				mode: isMode(record.mode) ? record.mode : BRIDGE_DEFAULT_STATE.mode,
			};
		}
	} catch {
		// No state yet, or unreadable — fall through to the default below.
	}
	return { ...BRIDGE_DEFAULT_STATE };
}

export function writeBridgeState(state: BridgeState): void {
	try {
		ensureSupersetHomeDirExists();
		writeFileSync(STATE_FILE, `${JSON.stringify(state, null, "\t")}\n`);
	} catch (error) {
		// Losing the preference is not worth failing the toggle the user just
		// pressed; the bridge itself is already running or stopped by now.
		console.warn("[mobile-bridge] Could not persist the switch", {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}
