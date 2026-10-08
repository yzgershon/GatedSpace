export type NamedSessionProvider = "claude" | "codex" | "terminal";
export interface SessionNameRef {
	provider: NamedSessionProvider;
	id?: string;
	key?: string;
}
export interface SessionName {
	title: string;
	source: "manual" | "generated";
}
export interface SessionNamesSnapshot {
	names: Record<string, SessionName>;
	aliases: Record<string, string>;
}
export function sessionNameKey(ref: SessionNameRef) {
	return `${ref.provider}:${ref.id || `pending:${ref.key}`}`;
}
export function resolveSessionName(
	snapshot: SessionNamesSnapshot,
	ref: SessionNameRef,
) {
	const key = sessionNameKey(ref);
	return snapshot.names[snapshot.aliases[key] ?? key];
}
export function cleanSessionName(value: string) {
	return value
		.replace(/[\r\n\t]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 120);
}
