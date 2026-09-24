/** Only the desktop's registered schemes and loopback receiver may receive tokens. */
export function desktopCallbackTarget(
	protocol = "gatedspace",
	callback?: string | null,
) {
	if (
		!/^(gatedspace|superset)(-[a-z0-9-]+)?$/.test(protocol) ||
		protocol.length > 100
	)
		throw new Error("Invalid desktop protocol");
	if (!callback) return { protocol, localCallback: undefined };
	const url = new URL(callback);
	if (
		url.protocol !== "http:" ||
		!["127.0.0.1", "localhost"].includes(url.hostname) ||
		!url.port ||
		Number(url.port) < 1024 ||
		url.pathname !== "/auth/callback" ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	)
		throw new Error("Invalid desktop callback");
	return { protocol, localCallback: url.toString() };
}
