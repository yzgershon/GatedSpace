import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build } from "vite";
import { z } from "zod";
import { SessionOrganizationStore } from "../src/main/lib/session-organization/store";
import {
	emptyOrganization,
	organizationCommand,
} from "../src/shared/session-organization";
import { sampleSessions } from "./organizer-preview/fixtures";

const desktop = resolve(import.meta.dir, "..");
const output = resolve(desktop, "../../.tmp/session-organizer-preview");
mkdirSync(output, { recursive: true });
if (!process.argv.includes("--skip-build"))
	await build({
		configFile: false,
		envFile: false,
		logLevel: "warn",
		define: { "process.env.NODE_ENV": JSON.stringify("production") },
		plugins: [react(), tailwindcss()],
		resolve: {
			alias: [
				...[
					"renderer/lib/trpc-client",
					"renderer/lib/host-trpc-client",
					"renderer/hooks/useCopyToClipboard",
					"renderer/assets/app-icons/preset-icons",
					"renderer/routes/_authenticated/providers/LocalHostServiceProvider",
				].map((find) => ({
					find,
					replacement: resolve(desktop, "scripts/organizer-preview/mock.ts"),
				})),
				{ find: "renderer", replacement: resolve(desktop, "src/renderer") },
				{ find: "shared", replacement: resolve(desktop, "src/shared") },
			],
		},
		build: {
			outDir: output,
			emptyOutDir: false,
			lib: {
				entry: resolve(desktop, "scripts/organizer-preview/renderer.tsx"),
				formats: ["iife"],
				name: "SessionOrganizerPreview",
				fileName: () => "renderer.js",
				cssFileName: "style",
			},
		},
	});
writeFileSync(
	resolve(output, "index.html"),
	'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GatedSpace Session Organizer</title><link rel="stylesheet" href="/style.css"></head><body><script src="/renderer.js"></script></body></html>',
);
if (process.argv.includes("--build-only")) process.exit(0);
const checks = process.argv.includes("--checks");
const file = resolve(output, checks ? "checks-projects.json" : "projects.json");
if (checks) writeFileSync(file, JSON.stringify(emptyOrganization()));
const fresh = checks || !existsSync(file);
const store = new SessionOrganizationStore(file);
if (fresh) {
	const work = store.apply({
		type: "createProject",
		name: "GatedSpace",
		session: sampleSessions[0],
	}).projects[0];
	for (const index of [4, 5])
		store.apply({
			type: "assign",
			session: sampleSessions[index],
			projectId: work.id,
		});
	store.apply({
		type: "createProject",
		name: "School",
		session: sampleSessions[3],
	});
}
const server = createServer(async (req, res) => {
	const url = new URL(req.url ?? "/", "http://localhost");
	try {
		if (url.pathname.startsWith("/api/")) {
			// Local, same-origin, sample-only test harness. Never reads the user's profile.
			if (
				req.headers.origin &&
				req.headers.origin !== `http://${req.headers.host}`
			) {
				res.writeHead(403).end();
				return;
			}
			let raw = "";
			for await (const chunk of req) {
				raw += chunk;
				if (raw.length > 20_000) throw new Error("Request too large");
			}
			const input = raw ? JSON.parse(raw) : {};
			let value: unknown;
			switch (url.pathname) {
				case "/api/organization":
					value = store.read();
					break;
				case "/api/organize":
					value = store.apply(
						organizationCommand.parse(input),
						sampleSessions.filter((s) => s.pinned),
					);
					break;
				case "/api/sessions":
					value = sampleSessions.filter(
						(s) =>
							s.provider === input.provider &&
							s.archived === Boolean(input.archived),
					);
					break;
				case "/api/pin":
				case "/api/archive":
				case "/api/rename": {
					const action = z
						.object({
							provider: z.enum(["claude", "codex"]),
							sessionId: z.string().uuid(),
							title: z.string().max(120).optional(),
							pinned: z.boolean().optional(),
							archived: z.boolean().optional(),
						})
						.parse(input);
					const row = sampleSessions.find(
						(s) =>
							s.provider === action.provider &&
							s.sessionId === action.sessionId,
					);
					if (!row) throw new Error("Not found");
					if (url.pathname === "/api/pin") row.pinned = !!action.pinned;
					if (url.pathname === "/api/archive") row.archived = !!action.archived;
					if (url.pathname === "/api/rename" && action.title)
						row.title = action.title;
					value = { ok: true };
					break;
				}
				default:
					res.writeHead(404).end();
					return;
			}
			res
				.writeHead(200, {
					"Content-Type": "application/json",
					"Cache-Control": "no-store",
				})
				.end(JSON.stringify(value));
			return;
		}
		const name = url.pathname.slice(1) || "index.html";
		if (!["index.html", "renderer.js", "style.css"].includes(name)) {
			res.writeHead(404).end();
			return;
		}
		res
			.writeHead(200, {
				"Content-Type": name.endsWith(".js")
					? "text/javascript"
					: name.endsWith(".css")
						? "text/css"
						: "text/html",
				"Cache-Control": "no-store",
			})
			.end(await readFile(resolve(output, name)));
	} catch (error) {
		res.writeHead(400, { "Content-Type": "application/json" }).end(
			JSON.stringify({
				error: error instanceof Error ? error.message : String(error),
			}),
		);
	}
});
server.listen(
	Number(process.env.ORGANIZER_PREVIEW_PORT || 8146),
	"127.0.0.1",
	() =>
		console.log(
			`Session organizer preview: http://127.0.0.1:${process.env.ORGANIZER_PREVIEW_PORT || 8146}`,
		),
);
