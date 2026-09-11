/**
 * The settings section you were last in.
 *
 * Every entry point into settings hardcoded `/settings/account`, so opening
 * settings always landed on the one page you are least likely to want and left
 * you to click back to Appearance, or Agents, or wherever you actually live.
 * This remembers, so the gear reopens where you left off.
 *
 * Persisted to `localStorage`, because "where was I" should survive a restart —
 * it is the same class of thing as a window position, not session state.
 *
 * Validated on read against a prefix rather than trusted: the value comes off
 * disk, and a stale route from an older build (a section that has since been
 * renamed or removed) would otherwise navigate into a 404 on every gear click.
 */
const STORAGE_KEY = "gatedspace:last-settings-route";

/** Where settings opens when nothing has been remembered yet. */
export const DEFAULT_SETTINGS_ROUTE = "/settings/account";

export function rememberSettingsRoute(pathname: string): void {
	// Only real settings pages. The layout route itself, and anything outside
	// the section, would send the next open somewhere it did not come from.
	if (!pathname.startsWith("/settings/")) return;
	try {
		localStorage.setItem(STORAGE_KEY, pathname);
	} catch {
		// Private mode or a full quota: falling back to the default is fine.
	}
}

export function getLastSettingsRoute(): string {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored?.startsWith("/settings/")) return stored;
	} catch {
		// Ignore and take the default.
	}
	return DEFAULT_SETTINGS_ROUTE;
}
