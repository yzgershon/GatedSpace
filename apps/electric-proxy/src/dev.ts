#!/usr/bin/env bun
/**
 * Platform-aware dev launcher for electric-proxy.
 *
 * wrangler dev runs on workerd, which ships no Windows ARM64 binary — on
 * that platform we serve the worker's fetch handler natively via Bun
 * (src/bun-server.ts) instead. Everywhere else, wrangler dev as upstream
 * intends.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";

const port = process.env.WRANGLER_PORT ?? "8787";
const isWindowsArm = process.platform === "win32" && process.arch === "arm64";

if (isWindowsArm) {
	await import("./bun-server");
} else {
	const child = spawn("bun", ["x", "wrangler", "dev", "--port", port], {
		cwd: join(import.meta.dirname, ".."),
		stdio: "inherit",
		shell: false,
	});
	child.on("exit", (code) => process.exit(code ?? 1));
}
