#!/usr/bin/env bun
/**
 * Cross-platform replacement for `sh -c 'exec <cmd> --port ${VAR:-default}'`
 * in app dev scripts — Windows has no `sh`, so the env-default expansion
 * moves here.
 *
 * Usage: bun dev-port.ts <ENV_VAR> <default-port> -- <command...>
 * Spawns `<command...> --port <resolved>` with inherited stdio.
 */
const [envVar, fallback, dashdash, ...cmd] = process.argv.slice(2);

if (!envVar || !fallback || dashdash !== "--" || cmd.length === 0) {
	console.error("usage: dev-port.ts <ENV_VAR> <default-port> -- <command...>");
	process.exit(1);
}

const port = process.env[envVar] || fallback;

const proc = Bun.spawn([...cmd, "--port", port], {
	stdio: ["inherit", "inherit", "inherit"],
	// Next.js uses PORT when it restarts after a config change. Keep it aligned
	// with the explicit --port value instead of leaking the monorepo's Streams
	// PORT into web/API child processes.
	env: { ...process.env, PORT: port },
});

process.exit(await proc.exited);
