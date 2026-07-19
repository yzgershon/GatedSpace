/**
 * Native Bun server for the electric-proxy worker.
 *
 * `wrangler dev` runs on workerd, which ships no win32-arm64 binary, so
 * Windows ARM64 cannot use it. The worker's fetch handler is plain
 * Request/Response code, and Bun.serve speaks the same interface — run it
 * directly. Env comes from .dev.vars (same file wrangler dev reads),
 * overridable by process env.
 *
 * Serves plain HTTP on WRANGLER_PORT — the same trust model as mobile dev,
 * which already talks to the proxy over plain HTTP because RN fetch rejects
 * Caddy's self-signed cert.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import worker from "./index";
import type { Env } from "./types";

function loadDevVars(): Record<string, string> {
	const file = join(import.meta.dirname, "..", ".dev.vars");
	if (!existsSync(file)) return {};
	const vars: Record<string, string> = {};
	for (const line of readFileSync(file, "utf-8").split(/\r?\n/)) {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
		if (m?.[1] && m[2] !== undefined) vars[m[1]] = m[2];
	}
	return vars;
}

const devVars = loadDevVars();
const env: Env = {
	AUTH_URL: process.env.AUTH_URL ?? devVars.AUTH_URL ?? "",
	ELECTRIC_SHAPE_URL:
		process.env.ELECTRIC_SHAPE_URL ?? devVars.ELECTRIC_SHAPE_URL,
	ELECTRIC_SECRET: process.env.ELECTRIC_SECRET ?? devVars.ELECTRIC_SECRET,
	ELECTRIC_SOURCE_ID:
		process.env.ELECTRIC_SOURCE_ID || devVars.ELECTRIC_SOURCE_ID || undefined,
	ELECTRIC_SOURCE_SECRET:
		process.env.ELECTRIC_SOURCE_SECRET ||
		devVars.ELECTRIC_SOURCE_SECRET ||
		undefined,
};

if (!env.AUTH_URL) {
	console.error("[electric-proxy:bun] AUTH_URL is not set — aborting");
	process.exit(1);
}

const port = Number(process.env.WRANGLER_PORT ?? 8787);

Bun.serve({
	port,
	// Electric long-polls; keep idle connections alive well past the poll window.
	idleTimeout: 120,
	fetch: (request) =>
		worker.fetch(
			request as unknown as Parameters<typeof worker.fetch>[0],
			env,
			{} as Parameters<typeof worker.fetch>[2],
		),
});

console.log(
	`[electric-proxy:bun] listening on http://localhost:${port} -> ${env.ELECTRIC_SHAPE_URL}`,
);
