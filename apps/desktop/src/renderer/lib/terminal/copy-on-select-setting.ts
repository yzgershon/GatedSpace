/**
 * A cached read of the copy-on-select setting.
 *
 * The check runs inside a selection handler, which is synchronous and fires
 * during a drag — it cannot await an IPC round trip. So the value is cached
 * here and refreshed when it changes.
 *
 * Defaults to OFF while unknown. The failure modes are not symmetrical: a
 * feature that takes a moment to start working is a shrug, whereas silently
 * replacing the clipboard of someone who never asked for it is the complaint
 * this setting exists to prevent.
 */
import { electronTrpcClient } from "renderer/lib/trpc-client";

let enabled = false;

export function isCopyOnSelectEnabled(): boolean {
	return enabled;
}

/** Pull the current value. Called at startup and after the toggle changes it. */
export async function refreshCopyOnSelectSetting(): Promise<void> {
	try {
		enabled = await electronTrpcClient.settings.getTerminalCopyOnSelect.query();
	} catch {
		// Leave the last known value rather than flipping to a default: a failed
		// refresh is not evidence the user changed their mind.
	}
}

/** Apply a value the UI just set, without waiting for a round trip. */
export function setCopyOnSelectEnabledLocally(value: boolean): void {
	enabled = value;
}
