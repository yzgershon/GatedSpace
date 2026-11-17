import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { isLocalPreviewUrl } from "../../../shared/local-preview";
import type { LocalPreviewStore } from "./local-preview-store";

interface PreviewHost {
	server: Server;
	origin: string;
	token: string;
	cookie: string;
}

/** One origin per saved preview, preserving absolute asset paths and SPA routes.
 * Only captured static files are served. A one-use bootstrap URL authorizes the
 * browser with an HttpOnly cookie; unrelated websites cannot read local output.
 */
export class PreviewBrowserBridge {
	private hosts = new Map<string, Promise<PreviewHost>>();
	constructor(private readonly store: Pick<LocalPreviewStore, "respond">) {}

	async openUrl(value: string): Promise<string> {
		if (!isLocalPreviewUrl(value)) throw new Error("Not a saved preview URL.");
		const url = new URL(value);
		if (url.pathname.startsWith("//")) throw new Error("Invalid preview path.");
		const check = await this.store.respond(
			new Request(url, { method: "HEAD" }),
		);
		if (!check.ok)
			throw new Error(
				"Saved preview unavailable. Reopen its output folder first.",
			);
		let host = this.hosts.get(url.hostname);
		if (!host) {
			host = this.createHost(url.hostname);
			this.hosts.set(url.hostname, host);
			host.catch(() => this.hosts.delete(url.hostname));
		}
		const ready = await host;
		// Rotate the bootstrap capability on every explicit Open in Chrome click.
		const ticket = randomBytes(24).toString("hex");
		ready.token = ticket;
		const target = new URL(ready.origin);
		target.pathname = url.pathname;
		target.search = url.search;
		target.hash = url.hash;
		target.searchParams.set("__gatedspace_open", ticket);
		return target.href;
	}

	private async createHost(id: string): Promise<PreviewHost> {
		const secret = randomBytes(32).toString("hex");
		const cookieName = `gs_preview_${id}`;
		const host: PreviewHost = {
			server: undefined as unknown as Server,
			origin: "",
			token: "",
			cookie: `${cookieName}=${secret}`,
		};
		const server = createServer(async (req, res) => {
			try {
				const expected = new URL(host.origin).host;
				if (
					req.headers.host !== expected ||
					!req.url?.startsWith("/") ||
					req.url.startsWith("//")
				) {
					res.writeHead(403).end("Preview access denied");
					return;
				}
				if (req.method !== "GET" && req.method !== "HEAD") {
					res.writeHead(405).end();
					return;
				}
				const url = new URL(req.url, host.origin);
				const ticket = url.searchParams.get("__gatedspace_open");
				if (ticket && host.token && ticket === host.token) {
					host.token = "";
					url.searchParams.delete("__gatedspace_open");
					res
						.writeHead(303, {
							Location: url.pathname + url.search,
							"Set-Cookie": `${host.cookie}; HttpOnly; SameSite=Strict; Path=/`,
							"Cache-Control": "no-store",
							"Referrer-Policy": "no-referrer",
						})
						.end();
					return;
				}
				const cookies = (req.headers.cookie ?? "")
					.split(";")
					.map((part) => part.trim());
				if (
					!cookies.includes(host.cookie) ||
					(req.headers.origin && req.headers.origin !== host.origin) ||
					req.headers["sec-fetch-site"] === "cross-site"
				) {
					res
						.writeHead(403)
						.end("Open this preview from GatedSpace to continue.");
					return;
				}
				const response = await this.store.respond(
					new Request(
						`gatedspace-preview://${id}${url.pathname}${url.search}`,
						{ method: req.method },
					),
				);
				res.writeHead(response.status, {
					...Object.fromEntries(response.headers),
					"Referrer-Policy": "no-referrer",
					"Cross-Origin-Resource-Policy": "same-origin",
				});
				res.end(
					req.method === "HEAD"
						? undefined
						: Buffer.from(await response.arrayBuffer()),
				);
			} catch {
				if (!res.headersSent) res.writeHead(500);
				res.end("Preview unavailable");
			}
		});
		host.server = server;
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => {
				server.off("error", reject);
				resolve();
			});
		});
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("Could not start preview server.");
		host.origin = `http://127.0.0.1:${address.port}`;
		server.unref();
		return host;
	}

	async close() {
		const hosts = await Promise.allSettled(this.hosts.values());
		this.hosts.clear();
		for (const result of hosts)
			if (result.status === "fulfilled") {
				result.value.server.closeAllConnections();
				result.value.server.close();
			}
	}
}
