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
 * Whichever is chosen, every request needs the token. It persists across
 * restarts (see `token.ts`) so a phone pairs once and stays paired; revoking is
 * an explicit action rather than a side effect of relaunching. That token
 * matters most in LAN mode, where it is the ONLY thing between the local
 * network and an agent that runs shell commands — and where it also travels in
 * cleartext, which is the argument for the HTTPS mode.
 */
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { networkInterfaces } from "node:os";
import express from "express";
import { buildTimeline } from "../../../shared/claude-session/timeline";
import { builtInThemes } from "../../../shared/themes/built-in";
import { getClaudeProfile } from "../claude-profile";
import { claudeSessionManager } from "../claude-session/session-manager";
import { loadSessionTranscript } from "../claude-session/transcript";
import { readProfileLimits } from "../claude-session/usage-refresh";
import { listClaudeSessions } from "../claude-sessions/claude-sessions";
import {
	type BridgeBindingMode,
	DEFAULT_BRIDGE_BINDING_MODE,
	resolveBinding,
} from "./binding";
import { MOBILE_BRIDGE_HTML } from "./client-html";
import { pushService } from "./push";
import {
	MOBILE_BRIDGE_ICON_SVG,
	MOBILE_BRIDGE_MANIFEST,
	MOBILE_BRIDGE_PAGE_VERSION,
	MOBILE_BRIDGE_SERVICE_WORKER,
} from "./pwa-assets";
import {
	startTailscaleServe,
	stopTailscaleServe,
	stopTailscaleServeSync,
} from "./tailscale-serve";
import { loadOrCreateBridgeToken, tokensMatch } from "./token";
import { mergeTranscriptWithBuffer } from "./transcript-merge";
import { listBridgeWorkspaceTargets } from "./workspace-targets";

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
 * The most the phone may ask for in one go.
 *
 * Someone scrolling back wants the beginning of the conversation, not a policy
 * about bandwidth — but an unbounded limit turns one tap into a multi-megabyte
 * response over cellular.
 */
const MAX_EVENTS_CEILING = 4_000;

/** Enough history to scroll without turning the list into a chore. */
const MAX_HISTORY_TO_PHONE = 40;

/**
 * A label for the session list.
 *
 * The pane key is a UUID, which tells you nothing on a phone where you might
 * have three sessions running. What is wanted is the same title the desktop tab
 * shows, and the desktop derives that from the transcript — so this asks the
 * same code rather than deriving a second, different answer.
 *
 * The buffer is only the fallback now. Reading it first is what produced
 * "Untitled session" for every resumed conversation: the opening prompt was
 * written by an earlier run and was never in this process's memory.
 */
function titleOf(key: string, sessionId: string | null): string {
	if (sessionId) {
		const stored = sessionTitles().get(sessionId);
		if (stored) return stored;
	}

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

/**
 * Titles by session id, for the sessions currently listed.
 *
 * `listClaudeSessions` caches per file and mtime, so calling it per request is
 * cheap after the first — it re-parses only transcripts that have changed.
 */
function sessionTitles(): Map<string, string> {
	const titles = new Map<string, string>();
	try {
		for (const summary of listClaudeSessions(MAX_HISTORY_TO_PHONE)) {
			titles.set(summary.sessionId, summary.title);
		}
	} catch {
		// Titles are a nicety; the list still works with fallbacks.
	}
	return titles;
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

		// Reused across restarts on purpose — see token.ts. A phone that paired
		// once stays paired.
		this.token = loadOrCreateBridgeToken();
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
		// Cleared from memory so a stopped bridge rejects everything, but NOT
		// rotated: the next start reloads the same token from disk, which is what
		// keeps the phone paired across an app restart.
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
			// NEVER cache this page.
			//
			// It ships inside the desktop app, so it changes with every update
			// while its URL stays identical — and the page strips its own query
			// string on load, so even a fresh link collapses to the same cache key
			// as the last one. A phone therefore had no way of knowing the page had
			// changed, and kept running an old script against a new app: the voice
			// duplication survived two releases that had already fixed it, and no
			// amount of reloading helped because the reload was served from cache.
			//
			// There is nothing to gain by caching a few KB served over loopback.
			res.setHeader("Cache-Control", "no-store, must-revalidate");
			res.setHeader("Pragma", "no-cache");
			res.setHeader("Expires", "0");
			// The page itself carries no secret — it reads the token out of its own
			// URL and keeps it client-side.
			res
				.type("html")
				.send(
					MOBILE_BRIDGE_HTML.replace(
						"__PAGE_VERSION__",
						MOBILE_BRIDGE_PAGE_VERSION,
					),
				);
		});

		// Lets the page be installed to the home screen and run without browser
		// chrome. No service worker: this is useless offline by design (it drives
		// a desktop that has to be reachable), and a stale service worker is a
		// worse version of the caching problem above.
		app.get("/manifest.webmanifest", (_req, res) => {
			res.setHeader("Cache-Control", "no-store");
			res.type("application/manifest+json").send(MOBILE_BRIDGE_MANIFEST);
		});

		app.get("/icon.svg", (_req, res) => {
			res.setHeader("Cache-Control", "no-store");
			res.type("image/svg+xml").send(MOBILE_BRIDGE_ICON_SVG);
		});

		// Unauthenticated on purpose: a service worker script is fetched by the
		// browser's own machinery, which does not carry our header. It contains no
		// secret — the token is in the URL the PAGE registers it with, and the page
		// needed the token to load at all.
		app.get("/sw.js", (_req, res) => {
			res.setHeader("Cache-Control", "no-store");
			res.type("application/javascript").send(MOBILE_BRIDGE_SERVICE_WORKER);
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
				sessionId: session.sessionId,
				running: session.running,
				title: titleOf(session.key, session.sessionId),
			}));
			res.json({ sessions });
		});

		/**
		 * Every theme the desktop has, so the phone can look like the desktop
		 * rather than approximating it.
		 *
		 * Sent as data rather than compiled CSS: the phone applies them as custom
		 * properties exactly as the renderer does, so adding a theme on the
		 * desktop makes it appear here with no work on this side.
		 */
		app.get("/api/themes", (_req, res) => {
			res.setHeader("Cache-Control", "no-store");
			res.json({
				themes: builtInThemes.map((theme) => ({
					id: theme.id,
					name: theme.name,
					type: theme.type,
					ui: theme.ui,
				})),
			});
		});

		/**
		 * Usage for EVERY account at once, which is the whole reason to look at
		 * this on a phone — the desktop toolbar shows the active one.
		 *
		 * Read straight off disk, never live-polled. Same rule the desktop
		 * follows: an app that hammers an API to draw a progress bar is how you
		 * get rate-limited by your own monitoring.
		 */
		app.get("/api/usage", (_req, res) => {
			res.setHeader("Cache-Control", "no-store");
			const state = getClaudeProfile();
			const accounts = state.profiles.map((profile) => ({
				id: profile.id,
				label: profile.label,
				active: profile.id === state.activeProfileId,
				limits: readProfileLimits(profile.configDir),
			}));
			res.json({ accounts });
		});

		/**
		 * Past sessions, from the transcripts on disk.
		 *
		 * Distinct from `/api/sessions`, which is what is RUNNING right now. The
		 * phone splits them into Active and History, and the two come from
		 * genuinely different places: live panes in memory, and transcript files.
		 */
		app.get("/api/history", (_req, res) => {
			res.setHeader("Cache-Control", "no-store");
			res.json({ sessions: listClaudeSessions(MAX_HISTORY_TO_PHONE) });
		});

		/**
		 * The key the phone needs before it can subscribe to push at all.
		 *
		 * Handed out rather than baked into the page: it is generated on this
		 * machine on first use, so the page cannot know it in advance.
		 */
		app.get("/api/push/key", (_req, res) => {
			res.setHeader("Cache-Control", "no-store");
			res.json({ publicKey: pushService.publicKey() });
		});

		app.post("/api/push/subscribe", (req, res) => {
			const body = req.body as { endpoint?: unknown };
			if (
				typeof body?.endpoint !== "string" ||
				!body.endpoint.startsWith("https://")
			) {
				res.status(400).json({ error: "bad subscription" });
				return;
			}
			pushService.subscribe(req.body as { endpoint: string });
			res.json({ ok: true });
		});

		app.post("/api/push/unsubscribe", (req, res) => {
			const endpoint = (req.body as { endpoint?: unknown })?.endpoint;
			if (typeof endpoint === "string") pushService.unsubscribe(endpoint);
			res.json({ ok: true });
		});

		/**
		 * What the service worker asks for after an empty push wakes it.
		 *
		 * Behind the token like everything else under /api — it carries the first
		 * line of a prompt, which is not something to hand to anyone who can reach
		 * the port.
		 */
		app.get("/api/push/pending", (_req, res) => {
			res.setHeader("Cache-Control", "no-store");
			const pending = pushService.takePending();
			if (!pending) {
				res.status(204).end();
				return;
			}
			res.json(pending);
		});

		/** Where a new session could run. Feeds the picker behind the "+". */
		app.get("/api/workspaces", (_req, res) => {
			res.setHeader("Cache-Control", "no-store");
			res.json({ workspaces: listBridgeWorkspaceTargets() });
		});

		/**
		 * Start a session from the phone.
		 *
		 * The working directory is never taken from the request — only a workspace
		 * id is, and the path is looked up here. A path parameter would make this
		 * endpoint "run an agent in any directory on my machine", which is a
		 * materially different thing to expose to the network than "carry on with
		 * the work already set up".
		 *
		 * No permission mode is passed, so the session inherits the CLI's own
		 * default exactly as a desktop pane does. Approvals cannot be answered
		 * from the phone (this CLI has no hook for them), so quietly loosening
		 * them here to avoid a session stalling would be a real change to what an
		 * agent may do, made invisibly.
		 */
		app.post("/api/sessions", (req, res) => {
			const body = req.body as { workspaceId?: unknown; text?: unknown };
			const text = typeof body?.text === "string" ? body.text.trim() : "";
			if (!text) {
				res.status(400).json({ error: "empty prompt" });
				return;
			}
			const target = listBridgeWorkspaceTargets().find(
				(workspace) => workspace.id === body?.workspaceId,
			);
			if (!target) {
				res.status(404).json({ error: "no such workspace" });
				return;
			}

			// The key is ours to invent — it names the pane, not the Claude
			// session — but it must be a fresh one. Reusing a key would attach the
			// phone to a conversation already open on the desktop, and two writers
			// on one transcript is how a transcript gets lost.
			const key = randomUUID();
			claudeSessionManager.start(key, { cwd: target.cwd });
			claudeSessionManager.send(key, text, false, []);
			res.json({ ok: true, key });
		});

		app.get("/api/sessions/:key/events", (req, res) => {
			const key = req.params.key;
			if (!claudeSessionManager.hasSession(key)) {
				res.status(404).json({ error: "no such session" });
				return;
			}

			// The replay buffer only goes back to the moment THIS process attached
			// to the session, which for a resumed one is nowhere near the start.
			// Served alone it made an ongoing conversation look like it began when
			// the phone happened to open it. The file on disk has the rest.
			const sessionId = claudeSessionManager
				.listSessions()
				.find((session) => session.key === key)?.sessionId;
			const stored = sessionId ? loadSessionTranscript(sessionId) : [];
			const events = mergeTranscriptWithBuffer(
				stored,
				claudeSessionManager.getBufferedEvents(key),
			);

			// The cap is a bandwidth choice, not a limit on what exists. The phone
			// asks for more when someone scrolls back, so a long conversation is
			// reachable in full rather than silently beginning in the middle.
			const requested = Number.parseInt(String(req.query.limit ?? ""), 10);
			const limit = Number.isFinite(requested)
				? Math.min(Math.max(requested, 20), MAX_EVENTS_CEILING)
				: MAX_EVENTS_TO_PHONE;

			// Folded with the SAME reducer the desktop uses, so the context figure
			// on the phone is the desktop's figure rather than a second opinion.
			// Built from everything, not the truncated slice — context occupancy is
			// a property of the conversation, not of how much of it was sent.
			const timeline = buildTimeline(events);

			res.json({
				running: claudeSessionManager.isRunning(key),
				events: events.slice(-limit),
				truncated: events.length > limit,
				...(timeline.usage ? { context: timeline.usage } : {}),
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
