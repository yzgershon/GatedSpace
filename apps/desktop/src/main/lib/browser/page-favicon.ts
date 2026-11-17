import type { WebContents } from "electron";
import { isLocalPreviewUrl } from "shared/local-preview";

const MAX_ICON_BYTES = 512 * 1024;
const ICON_TIMEOUT_MS = 5000;

// Read resolved hrefs, including <base> and icons inserted after initial load.
// Page content is data: it never supplies executable code to this resolver.
const ICON_LINKS = `(() => {
  const links = [...document.querySelectorAll('link[rel][href]')];
  const icons = links.filter(link => link.rel.toLowerCase().split(/\\s+/).includes('icon'));
  const touch = links.filter(link => /^apple-touch-icon(?:-precomposed)?$/i.test(link.rel));
  return [...icons, ...touch].slice(0, 12).map(link => link.href);
})()`;

function iconUrl(value: string, pageUrl: string): string | null {
	if (value.length > MAX_ICON_BYTES * 1.4) return null;
	try {
		const url = new URL(value, pageUrl);
		if (url.username || url.password) return null;
		if (/^https?:$/.test(url.protocol)) return url.href;
		if (url.protocol === "data:" && /^data:image\//i.test(value)) return value;
		if (
			isLocalPreviewUrl(url.href) &&
			url.host === new URL(pageUrl).host &&
			isLocalPreviewUrl(pageUrl)
		)
			return url.href;
	} catch {}
	return null;
}

function imageType(bytes: Buffer): string | null {
	if (
		bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
	)
		return "image/png";
	if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
		return "image/jpeg";
	if (/^GIF8[79]a/.test(bytes.subarray(0, 6).toString())) return "image/gif";
	if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0)
		return "image/x-icon";
	if (
		bytes.subarray(0, 4).toString() === "RIFF" &&
		bytes.subarray(8, 12).toString() === "WEBP"
	)
		return "image/webp";
	if (
		/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(
			bytes.toString("utf8"),
		)
	)
		return "image/svg+xml";
	if (
		bytes.subarray(4, 8).toString() === "ftyp" &&
		/avif|avis/.test(bytes.subarray(8, 32).toString())
	)
		return "image/avif";
	return null;
}

async function readIcon(wc: WebContents, url: string): Promise<string | null> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), ICON_TIMEOUT_MS);
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	try {
		if (url.startsWith("data:")) {
			const comma = url.indexOf(",");
			if (comma < 0) return null;
			const bytes = /;base64$/i.test(url.slice(0, comma))
				? Buffer.from(url.slice(comma + 1), "base64")
				: Buffer.from(decodeURIComponent(url.slice(comma + 1)), "utf8");
			const type = bytes.length <= MAX_ICON_BYTES ? imageType(bytes) : null;
			return type ? `data:${type};base64,${bytes.toString("base64")}` : null;
		}
		// Use the guest partition's cookies, cache and custom preview protocol.
		// The shell renderer has a different session and cannot reliably load
		// protected icons itself. Persist the bytes so sleeping/restored tabs work.
		const response = await wc.session.fetch(url, {
			signal: controller.signal,
			credentials: "include",
		});
		if (
			!response.ok ||
			Number(response.headers.get("content-length")) > MAX_ICON_BYTES
		)
			return null;
		reader = response.body?.getReader();
		if (!reader) return null;
		const chunks: Uint8Array[] = [];
		let size = 0;
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > MAX_ICON_BYTES) return null;
			chunks.push(value);
		}
		const bytes = Buffer.concat(chunks);
		const type = imageType(bytes);
		return type ? `data:${type};base64,${bytes.toString("base64")}` : null;
	} catch {
		return null;
	} finally {
		clearTimeout(timeout);
		await reader?.cancel().catch(() => {});
		controller.abort();
	}
}

const pending = new WeakMap<WebContents, Map<string, Promise<string | null>>>();

/** Resolve the site's actual icon; never send browsing history to an icon service. */
export function resolvePageFavicon(
	wc: WebContents,
	pageUrl: string,
	reported: string[] = [],
): Promise<string | null> {
	if (
		wc.isDestroyed() ||
		wc.getURL() !== pageUrl ||
		!/^(https?:|gatedspace-preview:)/.test(pageUrl)
	)
		return Promise.resolve(null);
	let requests = pending.get(wc);
	if (!requests) {
		requests = new Map();
		pending.set(wc, requests);
	}
	const key = JSON.stringify([pageUrl, reported]);
	const existing = requests.get(key);
	if (existing) return existing;
	const request = (async () => {
		const started = Date.now();
		const links: unknown = await wc
			.executeJavaScript(ICON_LINKS)
			.catch(() => []);
		const candidates = [
			...new Set(
				[
					...reported,
					...(Array.isArray(links)
						? links.filter((link): link is string => typeof link === "string")
						: []),
					new URL("/favicon.ico", pageUrl).href,
				]
					.map((value) => iconUrl(value, pageUrl))
					.filter((value): value is string => !!value),
			),
		].slice(0, 12);
		for (const candidate of candidates) {
			if (
				wc.isDestroyed() ||
				wc.getURL() !== pageUrl ||
				Date.now() - started >= 10000
			)
				return null;
			const icon = await readIcon(wc, candidate);
			if (icon && !wc.isDestroyed() && wc.getURL() === pageUrl) return icon;
		}
		return null;
	})();
	requests.set(key, request);
	void request.finally(() => requests.delete(key));
	return request;
}
