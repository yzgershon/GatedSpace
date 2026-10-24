/** No installer, no second provider process. Drives the running app through its authenticated API. */

import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { EnsembleEngine } from "../../src/main/lib/ensemble/engine";
import { LocalApiEnsembleTransport } from "../../src/main/lib/ensemble/local-api-transport";
import { EnsembleFileStorage } from "../../src/main/lib/ensemble/storage";
import { ensureSecureDir } from "../../src/main/lib/secure-file";
import { createEnsembleInput, memberInput } from "../../src/shared/ensemble";

const directory = resolve(import.meta.dir, "../../../../.tmp/ensemble-live");
ensureSecureDir(directory);
const assetDir = join(directory, "assets");
mkdirSync(assetDir, { recursive: true });
const build = await Bun.build({
	entrypoints: [join(import.meta.dir, "main.tsx")],
	outdir: assetDir,
	target: "browser",
	minify: true,
	sourcemap: "none",
	loader: { ".svg": "file" },
	define: { "process.env.NODE_ENV": '"production"' },
});
if (!build.success) throw new Error(build.logs.map(String).join("\n"));
const token = readFileSync(
	join(homedir(), ".superset/bridge-token"),
	"utf8",
).trim();
const ports = JSON.parse(
	execFileSync(
		"powershell.exe",
		[
			"-NoProfile",
			"-Command",
			"$ids=@(Get-Process GatedSpace -ErrorAction Stop | Select-Object -ExpandProperty Id); @(Get-NetTCPConnection -State Listen | Where-Object { $_.OwningProcess -in $ids -and $_.LocalAddress -eq '127.0.0.1' } | Select-Object -ExpandProperty LocalPort) | ConvertTo-Json -Compress",
		],
		{ windowsHide: true, encoding: "utf8" },
	),
) as number[];
let origin = "";
for (const port of ports) {
	try {
		const r = await fetch(`http://127.0.0.1:${port}/api/mobile/sessions`, {
			headers: { "x-bridge-token": token },
			signal: AbortSignal.timeout(3000),
			redirect: "error",
		});
		if (r.ok && Array.isArray((await r.json()).sessions)) {
			origin = `http://127.0.0.1:${port}`;
			break;
		}
	} catch {
		/* Other app listeners are not the authenticated session API. */
	}
}
if (!origin)
	throw new Error(
		"The already-enabled native session API could not be discovered.",
	);
const transport = new LocalApiEnsembleTransport(origin, token, new Set());
const engine = new EnsembleEngine(
	new EnsembleFileStorage(directory),
	transport,
);
engine.on("fault", (e) =>
	console.error(e instanceof Error ? e.message : "Coordinator error"),
);
for (const g of engine.list())
	for (const m of g.members) transport.remember(m.key, m.cwd, m.workspaceId);
const workspaceResponse = await transport.api<{
	workspaces: { id: string; name: string; project: string; cwd: string }[];
}>("/api/workspaces");
const workspaces = workspaceResponse.workspaces;
if (!workspaces?.length)
	throw new Error("No configured workspace was returned by GatedSpace.");
async function newSession(provider: "codex" | "claude", workspaceId: string) {
	const workspace = workspaces.find((w) => w.id === workspaceId);
	if (!workspace) throw new Error("Choose an existing workspace.");
	const result = await transport.api<{ key: string }>("/api/mobile/new", {
		provider,
		workspaceId,
		requestId: randomUUID(),
	});
	transport.remember(result.key, workspace.cwd, workspaceId);
	return result.key;
}
if (process.argv.includes("--seed-live") && !engine.list().length) {
	const workspace =
		workspaces.find(
			(w) => w.cwd.replace(/\\/g, "/").toLowerCase() === "c:/dev",
		) ?? workspaces[0];
	const coordinatorKey = await newSession("codex", workspace.id);
	const reviewerKey = await newSession("claude", workspace.id);
	const sessions = await transport.list();
	const coordinator = sessions.find((s) => s.key === coordinatorKey);
	const reviewer = sessions.find((s) => s.key === reviewerKey);
	if (!coordinator || !reviewer)
		throw new Error("Dedicated sessions did not become available.");
	await engine.create({
		title: "A library of useful things",
		goal: "Create a one-page launch brief for a fictional neighborhood tool-lending library called Borrowed. Use fresh fictional content only; do not read or change any existing project files. The coordinator should ask the other member for risks and a review, publish a concise artifact, and bring the reviewed result together. Use only the Flock response protocol for collaboration; no shell, web, filesystem, or other tools are needed for this writing exercise.",
		criteria:
			"A concise Markdown brief with a 30-day pilot, borrowing rules, three risks with practical mitigations, and a clear first action. Both providers must contribute; the final artifact needs an independent review of its current revision. Keep the whole workflow to at most 8 deliveries.",
		members: [
			{
				...coordinator,
				title: "Director",
				role: "Coordinator: develop the brief, delegate risk analysis, synthesize and close",
			},
			{
				...reviewer,
				title: "Critical friend",
				role: "Claude reviewer: challenge assumptions, identify risks, review the current artifact",
			},
		],
		commanderIndex: 0,
		maxMessages: 12,
		concurrency: 2,
	});
}
const secret = randomBytes(24).toString("hex");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Flock — GatedSpace</title><link rel="stylesheet" href="/main.css"><style>html,body,#root{margin:0;width:100%;height:100%;background:#20212c;color:#f0edf6;font-family:Segoe UI,sans-serif}button{font:inherit;cursor:pointer}</style></head><body><div id="root"></div><script type="module" src="/main.js"></script></body></html>`;
const id = z.string().uuid();
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	async fetch(req) {
		const url = new URL(req.url);
		if (req.headers.get("host") !== `127.0.0.1:${server.port}`)
			return new Response("Invalid host", { status: 403 });
		const headers = {
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
			"Referrer-Policy": "no-referrer",
		};
		if (url.pathname === "/")
			return new Response(html, {
				headers: {
					...headers,
					"Content-Type": "text/html; charset=utf-8",
					"Set-Cookie": `ensemble=${secret}; HttpOnly; SameSite=Strict; Path=/`,
				},
			});
		if (url.pathname === "/snapshot" || url.pathname === "/command") {
			if (
				!req.headers
					.get("cookie")
					?.split("; ")
					.includes(`ensemble=${secret}`) ||
				(req.headers.get("origin") &&
					req.headers.get("origin") !== `http://127.0.0.1:${server.port}`)
			)
				return new Response("Not authorized", { status: 403 });
			try {
				if (url.pathname === "/snapshot")
					return Response.json(
						{
							groups: engine.list(),
							sessions: await transport.list(),
							workspaces,
						},
						{ headers },
					);
				if (req.method !== "POST")
					return new Response("Method not allowed", { status: 405 });
				const bodyText = await req.text();
				if (bodyText.length > 128_000)
					return new Response("Too large", { status: 413 });
				const request = z
					.object({
						action: z.string(),
						input: z.record(z.string(), z.unknown()),
					})
					.parse(JSON.parse(bodyText));
				const input = request.input;
				let value: unknown;
				switch (request.action) {
					case "create":
						value = await engine.create(createEnsembleInput.parse(input));
						break;
					case "control":
						await engine.control(
							id.parse(input.id),
							z.enum(["start", "pause", "resume", "stop"]).parse(input.action),
						);
						break;
					case "message":
						engine.message(
							id.parse(input.id),
							z.string().parse(input.to),
							z.string().max(8000).parse(input.text),
						);
						break;
					case "update":
						engine.update(
							id.parse(input.id),
							z
								.object({
									goal: z.string().min(5).max(8000),
									criteria: z.string().min(5).max(4000),
									maxMessages: z.number().int().min(4).max(100),
								})
								.parse(input),
						);
						break;
					case "addMember":
						await engine.addMember(id.parse(input.id), {
							...memberInput.parse(input.member),
							id: "",
						});
						break;
					case "removeMember":
						engine.removeMember(
							id.parse(input.id),
							z.string().parse(input.memberId),
						);
						break;
					case "resolve":
						engine.resolve(
							id.parse(input.id),
							id.parse(input.messageId),
							z.boolean().parse(input.retry),
						);
						break;
					case "createSession": {
						const key = await newSession(
							z.enum(["codex", "claude"]).parse(input.provider),
							z.string().parse(input.workspaceId),
						);
						value = (await transport.list()).find((s) => s.key === key);
						if (!value)
							throw new Error(
								"Session created; select it from the session list once ready.",
							);
						break;
					}
					case "conversation": {
						const s = (await transport.list()).find(
							(s) => s.key === input.key && s.provider === input.provider,
						);
						if (!s) throw new Error("Choose a session in this demonstration.");
						value = await transport.api(
							`/api/mobile/${s.provider}/${encodeURIComponent(s.key)}`,
						);
						break;
					}
					default:
						throw new Error("Unknown action");
				}
				return Response.json({ value: value ?? null }, { headers });
			} catch (e) {
				return Response.json(
					{ error: e instanceof Error ? e.message : "Request failed" },
					{ status: 409, headers },
				);
			}
		}
		const file = join(assetDir, url.pathname.slice(1));
		if (dirname(file) !== assetDir)
			return new Response("Not found", { status: 404 });
		return new Response(Bun.file(file), { headers });
	},
});
const timer = setInterval(() => {
	if (
		engine
			.list()
			.some(
				(g) =>
					g.status === "running" ||
					g.messages.some((m) => m.status === "delivered"),
			)
	)
		engine.wake();
}, 2000);
process.on("SIGINT", () => {
	clearInterval(timer);
	engine.dispose();
	server.stop();
	process.exit();
});
writeFileSync(
	join(directory, "preview.json"),
	JSON.stringify({
		url: `http://127.0.0.1:${server.port}`,
		pid: process.pid,
		directory,
		kind: "live native sessions via local API; same product engine and React interface",
	}),
);
console.log(`Flock live interface: http://127.0.0.1:${server.port}`);
