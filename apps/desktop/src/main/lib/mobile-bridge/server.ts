/**
 * A phone-sized window onto the Claude sessions running in GatedSpace.
 *
 * The point is to keep an agent moving while away from the desk: see what the
 * sessions are doing, read the last of a transcript, send the next prompt. It
 * is deliberately NOT a remote desktop — no terminals, no file editing, no
 * shell. Those are the things whose remote version is indistinguishable from a
 * backdoor, and the phone is the device most likely to be lost.
 *
 * Reach is a choice, made in `binding.ts`: LAN by default (same network, no
 * setup — what BridgeSpace does), Tailscale for anywhere-with-signal without
 * exposing the local network, Tailscale-with-HTTPS when the link should be
 * encrypted, loopback for fronting with your own tunnel.
 *
 * Whichever is chosen, every request needs the token, which is regenerated on
 * each enable so turning the switch off is a real revocation rather than a
 * pause. That matters most in LAN mode, where the token is the ONLY thing
 * between the local network and an agent that runs shell commands — and where
 * it also travels in cleartext, which is the argument for the HTTPS mode.
 */
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { networkInterfaces } from "node:os";
import express from "express";
import { claudeSessionManager } from "../claude-session/session-manager";
import {
	type BridgeBindingMode,
	DEFAULT_BRIDGE_BINDING_MODE,
	resolveBinding,
} from "./binding";
import { MOBILE_BRIDGE_HTML } from "./client-html";
import {
	startTailscaleServe,
	stopTailscaleServe,
	stopTailscaleServeSync,
} from "./tailscale-serve";
import { generateBridgeToken, tokensMatch } from "./token";

export interface BridgeStatus {
	running: boolean;
	url?: string;
	address?: string;
	port?: number;
	mode?: BridgeBindingMode;
	/**
	 * True when the phone reaches this over HTTPS. The page reads it as a secure
	 * context, which is what browsers require before granting a microphone — so
	 * this is also "is the voice button available".
	 */
	secure?: boolean;
	error?: string;
}

/** A body bigger than this is not a prompt someone typed on a phone. */
const MAX_PROMPT_BYTES = 32 * 1024;

/**
 * How much of a transcript the phone gets. A session can run to megabytes, and
 * a phone on cellular does not want them; the recent end is the part that
 * answers "what is it doing".
 */
const MAX_EVENTS_TO_PHONE = 200;

/**
 * A label for the session list.
 *
 * The pane key is a UUID, which tells you nothing on a phone where you might
 * have three sessions running. The first thing asked is what the conversation
 * is about, same as the desktop tab titles.
 */
function firstPromptOf(key: string): string {
	for (const event of claudeSessionManager.getBufferedEvents(key)) {
		if (event.type === "local_user_message" && event.text.trim()) {
			return event.text.trim().slice(0, 80);
		}
		const content = (event as { message?: { content?: unknown } }).message
			?.content;
		if (
			event.type === "user" &&
			typeof content === "string" &&
			content.trim()
		) {
			return content.trim().slice(0, 80);
		}
	}
	return "Untitled session";
}

class MobileBridge {
	private server: Server | null = null;
	private token = "";
	private address = "";
	private port = 0;
	private mode: BridgeBindingMode = DEFAULT_BRIDGE_BINDING_MODE;
	private lastError: string | undefined;
	/**
	 * Set only in `tailscale-serve` mode, where Tailscale fronts the bridge with
	 * a real certificate and the phone talks to a DNS name on 443 rather than to
	 * our loopback port.
	 */
	private publicOrigin: string | null = null;

	status(): BridgeStatus {
		if (!this.server) {
			return {
				running: false,
				...(this.lastError && { error: this.lastError }),
			};
		}
		const origin = this.publicOrigin ?? `http://${this.address}:${this.port}`;
		return {
			running: true,
			address: this.address,
			port: this.port,
			mode: this.mode,
			secure: this.publicOrigin !== null,
			url: `${origin}/?t=${this.token}`,
		};
	}

	async start(mode: BridgeBindingMode): Promise<BridgeStatus> {
		if (this.server) return this.status();

		const binding = resolveBinding(mode, networkInterfaces());
		if ("error" in binding) {
			this.mode = mode;
			this.lastError = binding.error;
			return this.status();
		}

		this.token = generateBridgeToken();
		const app = this.buildApp();

		try {
			this.server = await new Promise<Server>((resolve, reject) => {
				// Port 0: let the OS pick. A fixed port is one more thing to collide
				// with, and the URL is copied rather than typed.
				const server = app.listen(0, binding.bindAddress, () =>
					resolve(server),
				);
				server.on("error", reject);
			});
		} catch (error) {
			this.server = null;
			this.lastError =
				error instanceof Error ? error.message : "Could not start the bridge";
			return this.status();
		}

		const bound = this.server.address();
		this.mode = mode;
		// The DISPLAY address, not the bind address: LAN binds 0.0.0.0, which is
		// not something anyone can open on a phone.
		this.address = binding.displayAddress;
		this.port = typeof bound === "object" && bound ? bound.port : 0;
		this.publicOrigin = null;
		this.lastError = undefined;

		if (mode === "tailscale-serve") {
			const served = await startTailscaleServe(this.port);
			if (served.error || !served.url) {
				// Close the listener rather than leaving it up on loopback: the user
				// asked for an HTTPS link, and silently running an unreachable HTTP
				// one instead is the kind of "partial success" that gets trusted.
				this.server.close();
				this.server = null;
				this.port = 0;
				this.address = "";
				this.lastError = served.error ?? "Tailscale serve failed.";
				return this.status();
			}
			this.publicOrigin = served.url;
		}

		return this.status();
	}

	async stop(): Promise<BridgeStatus> {
		const wasServing = this.teardown();
		if (wasServing) {
			// Tailscale's serve config outlives this process, so leaving it in
			// place would keep publishing a now-dead port to the tailnet.
			await stopTailscaleServe();
		}
		return this.status();
	}

	/**
	 * Quit path. Blocks on the Tailscale teardown because the callers cannot
	 * await — `exitImmediately` calls `app.exit(0)` on the next line.
	 */
	stopSync(): BridgeStatus {
		if (this.teardown()) stopTailscaleServeSync();
		return this.status();
	}

	/** Closes the socket and forgets the token. Returns whether serve was up. */
	private teardown(): boolean {
		const wasServing = this.publicOrigin !== null;
		this.server?.close();
		this.server = null;
		// Drop the token too: a stopped bridge that remembers its token would
		// come back accepting credentials the user thinks they revoked.
		this.token = "";
		this.address = "";
		this.port = 0;
		this.publicOrigin = null;
		return wasServing;
	}

	private buildApp(): express.Express {
		const app = express();
		app.use(express.json({ limit: MAX_PROMPT_BYTES }));

		// No CORS headers anywhere on purpose. Nothing should be calling this
		// from another origin, and `Access-Control-Allow-Origin: *` on a
		// token-authenticated API is how a token leaks to a page the user
		// happened to have open.

		app.get("/", (_req, res) => {
			// The page itself carries no secret — it reads the token out of its own
			// URL and keeps it client-side.
			res.type("html").send(MOBILE_BRIDGE_HTML);
		});

		app.use("/api", (req, res, next) => {
			const provided =
				req.get("x-bridge-token") ??
				(typeof req.query.t === "string" ? req.query.t : undefined);
			if (!tokensMatch(this.token, provided)) {
				res.status(401).json({ error: "unauthorized" });
				return;
			}
			next();
		});

		app.get("/api/sessions", (_req, res) => {
			// `listSessions`, NOT `getLiveSessionIds`: the latter returns Claude's
			// own session ids, which cannot be passed back to send/events. A list
			// keyed by those would render fine and open nothing.
			const sessions = claudeSessionManager.listSessions().map((session) => ({
				key: session.key,
				running: session.running,
				title: firstPromptOf(session.key),
			}));
			res.json({ sessions });
		});

		app.get("/api/sessions/:key/events", (req, res) => {
			const key = req.params.key;
			if (!claudeSessionManager.hasSession(key)) {
				res.status(404).json({ error: "no such session" });
				return;
			}
			const events = claudeSessionManager.getBufferedEvents(key);
			res.json({
				running: claudeSessionManager.isRunning(key),
				events: events.slice(-MAX_EVENTS_TO_PHONE),
			});
		});

		app.post("/api/sessions/:key/send", (req, res) => {
			const key = req.params.key;
			const text = (req.body as { text?: unknown })?.text;
			if (typeof text !== "string" || !text.trim()) {
				res.status(400).json({ error: "empty prompt" });
				return;
			}
			if (!claudeSessionManager.hasSession(key)) {
				res.status(404).json({ error: "no such session" });
				return;
			}
			claudeSessionManager.send(key, text, false, []);
			res.json({ ok: true, id: randomUUID() });
		});

		return app;
	}
}

export const mobileBridge = new MobileBridge();
