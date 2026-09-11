const backgroundTerminalIds = new Set<string>();
const backgroundTerminalMarkersByWorkspace = new Map<string, Set<string>>();
const markerListeners = new Set<() => void>();
/*
 * Where a backgrounded shell CAME FROM, keyed by terminal id.
 *
 * The daemon only knows a session's own title, which for an agent shell is the
 * program name — every row in the list reads "claude". What you actually want
 * to know is which tab it belongs to ("GatedSpace Edits"), and that is renderer
 * state the daemon never sees, so it has to be captured at the moment the
 * terminal is sent to the background.
 *
 * Deliberately NOT cleared alongside the marker set. A marker is cleared as
 * soon as the shell goes idle, and an idle shell that starts working again
 * should still know its name.
 */
const backgroundTerminalLabels = new Map<string, string>();

function emitMarkerChange(): void {
	for (const listener of markerListeners) {
		listener();
	}
}

function getWorkspaceMarkers(workspaceId: string): Set<string> {
	const existing = backgroundTerminalMarkersByWorkspace.get(workspaceId);
	if (existing) return existing;

	const markers = new Set<string>();
	backgroundTerminalMarkersByWorkspace.set(workspaceId, markers);
	return markers;
}

export function markTerminalForBackground(
	terminalId: string,
	workspaceId?: string,
	label?: string,
): void {
	backgroundTerminalIds.add(terminalId);

	if (label) backgroundTerminalLabels.set(terminalId, label);

	if (!workspaceId) return;

	const markers = getWorkspaceMarkers(workspaceId);
	if (markers.has(terminalId)) return;

	markers.add(terminalId);
	emitMarkerChange();
}

export function consumeTerminalBackgroundIntent(terminalId: string): boolean {
	return backgroundTerminalIds.delete(terminalId);
}

export function clearTerminalBackgroundMarker(
	workspaceId: string,
	terminalId: string,
): void {
	const markers = backgroundTerminalMarkersByWorkspace.get(workspaceId);
	if (!markers?.delete(terminalId)) return;

	if (markers.size === 0) {
		backgroundTerminalMarkersByWorkspace.delete(workspaceId);
	}
	emitMarkerChange();
}

/** The tab a backgrounded shell came from, if it was captured. */
export function getTerminalBackgroundLabel(
	terminalId: string,
): string | undefined {
	return backgroundTerminalLabels.get(terminalId);
}

/** Called once a session is adopted back or killed, so the map cannot grow. */
export function forgetTerminalBackgroundLabel(terminalId: string): void {
	backgroundTerminalLabels.delete(terminalId);
}

export function getTerminalBackgroundMarkerIdsKey(workspaceId: string): string {
	const markers = backgroundTerminalMarkersByWorkspace.get(workspaceId);
	return JSON.stringify(markers ? [...markers].sort() : []);
}

export function subscribeTerminalBackgroundMarkers(
	listener: () => void,
): () => void {
	markerListeners.add(listener);
	return () => {
		markerListeners.delete(listener);
	};
}
