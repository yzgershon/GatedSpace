#!/usr/bin/env bun
/**
 * Cross-platform postinstall (replaces postinstall.sh so Windows works).
 *
 * Prevent infinite recursion during postinstall:
 * electron-builder install-app-deps can trigger nested bun installs
 * which would re-run postinstall, spawning hundreds of processes.
 */
import { $ } from "bun";

if (process.env.SUPERSET_POSTINSTALL_RUNNING) {
	process.exit(0);
}
process.env.SUPERSET_POSTINSTALL_RUNNING = "1";

// Run sherif for workspace validation
await $`sherif`;

// GitHub CI runs multiple Bun install jobs that do not need desktop native rebuilds.
// Running electron-builder here can trigger nested Bun installs while the main
// install is still materializing packages, which has been flaky with native deps.
if (process.env.CI) {
	process.exit(0);
}

// Install native dependencies for desktop app
await $`bun run --filter=@superset/desktop install:deps`;

// Install vendored win32-arm64 binaries upstream doesn't publish (no-op elsewhere)
await $`bun ./scripts/vendor-native-win-arm64.ts`;
