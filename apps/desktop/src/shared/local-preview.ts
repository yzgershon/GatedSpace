export const LOCAL_PREVIEW_SCHEME = "gatedspace-preview";

export function isLocalPreviewUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return (
			url.protocol === `${LOCAL_PREVIEW_SCHEME}:` &&
			/^[a-f0-9]{32}$/.test(url.hostname) &&
			!url.port &&
			!url.username &&
			!url.password
		);
	} catch {
		return false;
	}
}

export function loopbackPreviewUrl(value: string): URL | null {
	try {
		const url = new URL(value);
		return url.protocol === "http:" &&
			["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
			!url.username &&
			!url.password
			? url
			: null;
	} catch {
		return null;
	}
}
