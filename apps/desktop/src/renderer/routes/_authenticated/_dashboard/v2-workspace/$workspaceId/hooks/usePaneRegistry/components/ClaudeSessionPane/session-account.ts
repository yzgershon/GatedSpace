/**
 * Which Claude account a session pane is pinned to.
 *
 * The account used to be a single global setting: whichever profile the
 * switcher named, resolved fresh at every spawn. That made the honest answer to
 * "which account is this pane on?" *unknowable* — under "auto" it could differ
 * between two panes started a minute apart, and changing the setting moved
 * nothing you were looking at. It was the single biggest reason a switch felt
 * like it had only registered in the front end.
 *
 * A pin is per PANE, taken by `/swap`, and it wins over the global setting for
 * that pane forever after. So the pane header can state a fact rather than a
 * default, and a swap you can see is a swap that happened.
 *
 * Its own module, not part of `sessionStore`, for the reason `composer-draft`
 * is: `sessionStore` reaches the electron tRPC client, which has no global
 * outside a renderer, so a test cannot import it.
 */

export interface PinnedAccount {
	id: string;
	label: string;
	/** Absolute path passed to the transport as CLAUDE_CONFIG_DIR. */
	configDir: string;
}

const PIN_STORAGE_PREFIX = "gatedspace:session-account:";

const pins = new Map<string, PinnedAccount>();
/** Panes whose stored pin has already been consulted, hit or miss. */
const loaded = new Set<string>();
const listeners = new Map<string, Set<() => void>>();

/**
 * Pins persist, and that is deliberate.
 *
 * The alternative — a pin that dies with the window — means reopening the app
 * silently moves every swapped pane back onto the default account while its
 * transcript, its folder and its title all say it is the same session. That is
 * the exact class of "did it really switch?" this feature exists to end, so the
 * pin outlives the process the same way the draft does.
 */
function readStoredPin(key: string): PinnedAccount | null {
	try {
		const raw = localStorage.getItem(PIN_STORAGE_PREFIX + key);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return null;
		const pin = parsed as Partial<PinnedAccount>;
		if (
			typeof pin.id !== "string" ||
			typeof pin.label !== "string" ||
			typeof pin.configDir !== "string"
		) {
			return null;
		}
		return { id: pin.id, label: pin.label, configDir: pin.configDir };
	} catch {
		// Private mode, quota, a value written by an older build: a pin is never
		// worth throwing inside a render. Falling back to the global account is
		// the same behaviour as never having swapped.
		return null;
	}
}

function writeStoredPin(key: string, pin: PinnedAccount | null): void {
	try {
		if (pin)
			localStorage.setItem(PIN_STORAGE_PREFIX + key, JSON.stringify(pin));
		else localStorage.removeItem(PIN_STORAGE_PREFIX + key);
	} catch {
		// Same as above: the in-memory Map still holds it for this window.
	}
}

function notify(key: string): void {
	for (const listener of listeners.get(key) ?? []) listener();
}

/** The account this pane is pinned to, or null to follow the global setting. */
export function getPinnedAccount(key: string): PinnedAccount | null {
	if (!loaded.has(key)) {
		loaded.add(key);
		const stored = readStoredPin(key);
		if (stored) pins.set(key, stored);
	}
	return pins.get(key) ?? null;
}

export function setPinnedAccount(key: string, pin: PinnedAccount): void {
	loaded.add(key);
	pins.set(key, pin);
	writeStoredPin(key, pin);
	notify(key);
}

/** Drop the pin so this pane follows the global setting again. */
export function clearPinnedAccount(key: string): void {
	loaded.add(key);
	pins.delete(key);
	writeStoredPin(key, null);
	notify(key);
}

export function subscribePinnedAccount(
	key: string,
	listener: () => void,
): () => void {
	let set = listeners.get(key);
	if (!set) {
		set = new Set();
		listeners.set(key, set);
	}
	set.add(listener);
	return () => {
		set.delete(listener);
		if (set.size === 0) listeners.delete(key);
	};
}

/** Called when a pane closes for good, so its pin doesn't outlive it. */
export function forgetPinnedAccount(key: string): void {
	pins.delete(key);
	loaded.delete(key);
	listeners.delete(key);
	writeStoredPin(key, null);
}
