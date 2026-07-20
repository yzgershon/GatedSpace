import * as childProcess from "node:child_process";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import path from "node:path";
import { settings } from "@superset/local-db";
import { getHostId, getHostName } from "@superset/shared/host-info";
import { app, dialog } from "electron";
import log from "electron-log/main";
import { env as sharedEnv } from "shared/env.shared";
import { getProcessEnvWithShellPath } from "../../lib/trpc/routers/workspaces/utils/shell-env";
import { SUPERSET_HOME_DIR } from "./app-environment";
import { isInternalBuild } from "./build-channel";
import {
	isProcessAlive,
	killProcess,
	manifestDir,
	readManifest,
	removeManifest,
} from "./host-service-manifest";
import {
	findFreePort,
	HEALTH_POLL_TIMEOUT_MS,
	MAX_HOST_LOG_BYTES,
	openRotatingLogFd,
	pollHealthCheck,
} from "./host-service-utils";
import { localDb } from "./local-db";
import { getRelayUrl } from "./relay-url";
import { HOOK_PROTOCOL_VERSION } from "./terminal/env";

export type HostServiceStatus = "starting" | "running" | "stopped";

export interface Connection {
	port: number;
	secret: string;
	machineId: string;
}

export interface HostServiceStatusEvent {
	organizationId: string;
	status: HostServiceStatus;
	previousStatus: HostServiceStatus | null;
}

export interface SpawnConfig {
	authToken: string;
	cloudApiUrl: string;
	/** Local-only mode: the child skips all cloud API calls and relay exposure. */
	localOnly?: boolean;
}

interface HostServiceProcess {
	pid: number;
	port: number;
	secret: string;
	status: HostServiceStatus;
}

// High, uncommon user-space range: above usual web/dev server ports and below
// macOS's default ephemeral range, while still falling back if occupied.
const STABLE_PORT_BASE = 48_000;
const STABLE_PORT_COUNT = 1_000;

function getStablePortForOrganization(organizationId: string): number {
	let hash = 2_166_136_261;
	for (let index = 0; index < organizationId.length; index++) {
		hash ^= organizationId.charCodeAt(index);
		hash = Math.imul(hash, 16_777_619);
	}
	return STABLE_PORT_BASE + ((hash >>> 0) % STABLE_PORT_COUNT);
}

function isValidPort(port: number | null | undefined): port is number {
	return (
		typeof port === "number" &&
		Number.isInteger(port) &&
		port > 0 &&
		port <= 65_535
	);
}

/**
 * Crash supervision. The host-service child loads native addons
 * (better-sqlite3, and tokenizer/embedding libs pulled in through
 * @mastra/memory) that can fault the whole process with a Windows access
 * violation (exit 3221225477 / 0xC0000005) or heap corruption (exit
 * 3221226356 / 0xC0000374). Those bypass V8, so the child's own
 * uncaughtException safety net can't catch them — the process just dies.
 *
 * The pty-daemon that owns the user's shells is a *separate*, surviving
 * process, so respawning the host-service re-adopts it and the renderer
 * reconnects on its 5s getConnection poll — no lost terminals. Restart on
 * every unexpected crash; if the child starts crash-looping (more than
 * CRASH_BUDGET deaths within CRASH_WINDOW_MS) back off RESTART_BACKOFF_MS
 * between attempts instead of hammering, but never permanently give up so a
 * transient fault still self-heals.
 */
const CRASH_BUDGET = 3;
const CRASH_WINDOW_MS = 60_000;
const RESTART_BACKOFF_MS = 15_000;
/** Don't pop the crash-loop dialog more than once per this window. */
const CRASH_LOOP_ALERT_THROTTLE_MS = 5 * 60_000;

export interface HostServiceRestartPlan {
	/** ms to wait before respawning; 0 = immediate. */
	delayMs: number;
	/** Crash count within the window, this crash included. */
	crashesInWindow: number;
	/** True when the crash budget was exceeded — i.e. we're crash-looping. */
	looping: boolean;
	/** Crash timestamps to keep going forward. */
	retained: number[];
}

/**
 * Pure crash-supervision policy, split out so the budget/backoff logic is
 * unit-testable without spawning real processes. Given the recent crash
 * timestamps and the current time, decide how long to wait before respawning.
 */
export function planHostServiceRestart({
	recentCrashTimestamps,
	now,
	budget = CRASH_BUDGET,
	windowMs = CRASH_WINDOW_MS,
	backoffMs = RESTART_BACKOFF_MS,
}: {
	recentCrashTimestamps: number[];
	now: number;
	budget?: number;
	windowMs?: number;
	backoffMs?: number;
}): HostServiceRestartPlan {
	const withinWindow = recentCrashTimestamps.filter((t) => now - t < windowMs);
	withinWindow.push(now);
	const crashesInWindow = withinWindow.length;
	if (crashesInWindow > budget) {
		// Reset the window after a backoff so successive loops don't compound
		// into ever-longer counts — each backoff earns a fresh CRASH_BUDGET.
		return { delayMs: backoffMs, crashesInWindow, looping: true, retained: [] };
	}
	return { delayMs: 0, crashesInWindow, looping: false, retained: withinWindow };
}

/**
 * Coupled to Electron: each child is spawned attached and SIGTERMed on
 * before-quit. PTYs survive across Electron restarts via the pty-daemon
 * layer host-service supervises, not via host-service itself. Manifests
 * are still written by the child for the CLI's benefit.
 */
export class HostServiceCoordinator extends EventEmitter {
	private instances = new Map<string, HostServiceProcess>();
	private pendingStarts = new Map<string, Promise<Connection>>();
	private lastKnownPorts = new Map<string, number>();
	private scriptPath = path.join(__dirname, "host-service.js");
	private machineId = getHostId();
	private devReloadWatcher: fs.FSWatcher | null = null;
	/** Recent unexpected-crash timestamps per orgId, for the restart backoff. */
	private crashTimes = new Map<string, number[]>();
	/** Pending auto-restart timers per orgId, so stop()/quit can cancel them. */
	private restartTimers = new Map<string, ReturnType<typeof setTimeout>>();
	/** Last time the crash-loop dialog was shown per orgId, for throttling. */
	private lastCrashAlertAt = new Map<string, number>();
	/** Set on stopAll() (app quit) so a queued restart never respawns a child. */
	private shuttingDown = false;

	async start(
		organizationId: string,
		config: SpawnConfig,
	): Promise<Connection> {
		return this.startWithPreferredPorts(organizationId, config);
	}

	private async startWithPreferredPorts(
		organizationId: string,
		config: SpawnConfig,
		preferredPorts?: Iterable<number>,
	): Promise<Connection> {
		const existing = this.instances.get(organizationId);
		if (existing?.status === "running") {
			return {
				port: existing.port,
				secret: existing.secret,
				machineId: this.machineId,
			};
		}

		const pending = this.pendingStarts.get(organizationId);
		if (pending) return pending;

		const startPromise = this.spawn(
			organizationId,
			config,
			preferredPorts ?? this.getPreferredPorts(organizationId),
		);
		this.pendingStarts.set(organizationId, startPromise);

		try {
			return await startPromise;
		} finally {
			this.pendingStarts.delete(organizationId);
		}
	}

	private getPreferredPorts(organizationId: string): number[] {
		const ports = [
			this.instances.get(organizationId)?.port,
			this.lastKnownPorts.get(organizationId),
			getStablePortForOrganization(organizationId),
		];
		const uniquePorts: number[] = [];
		const seen = new Set<number>();

		for (const port of ports) {
			if (!isValidPort(port) || seen.has(port)) continue;
			seen.add(port);
			uniquePorts.push(port);
		}

		return uniquePorts;
	}

	private rememberPort(organizationId: string, port: number): void {
		if (!isValidPort(port)) return;
		this.lastKnownPorts.set(organizationId, port);
	}

	stop(organizationId: string): void {
		// An intentional stop is a clean slate: cancel any queued auto-restart
		// and reset crash accounting so a later start isn't instantly throttled.
		this.clearRestartTimer(organizationId);
		this.crashTimes.delete(organizationId);
		this.lastCrashAlertAt.delete(organizationId);

		const instance = this.instances.get(organizationId);
		if (!instance) return;

		const previousStatus = instance.status;
		instance.status = "stopped";
		this.rememberPort(organizationId, instance.port);

		try {
			killProcess(instance.pid, "SIGTERM");
		} catch {}

		this.instances.delete(organizationId);
		removeManifest(organizationId);
		this.emitStatus(organizationId, "stopped", previousStatus);
	}

	stopAll(): void {
		// App is quitting — block any in-flight or queued auto-restart from
		// spawning a fresh child that would outlive the window.
		this.shuttingDown = true;
		for (const timer of this.restartTimers.values()) clearTimeout(timer);
		this.restartTimers.clear();
		for (const [id] of this.instances) {
			this.stop(id);
		}
	}

	async restart(
		organizationId: string,
		config: SpawnConfig,
	): Promise<Connection> {
		const preferredPorts = this.getPreferredPorts(organizationId);
		this.stop(organizationId);
		return this.startWithPreferredPorts(organizationId, config, preferredPorts);
	}

	/**
	 * Forcefully reset host-service state for an org. Unlike `restart`, this
	 * SIGKILLs whatever pid the manifest names — even when no instance is
	 * tracked in this process (e.g. a stale manifest left by a CLI-spawned
	 * host-service) — then removes the manifest so callers can't pick up the
	 * stale entry, and respawns. Used by the recovery path for
	 * superset-sh/superset#4299 where a wedged host-service keeps serving
	 * stale state.
	 */
	async reset(
		organizationId: string,
		config: SpawnConfig,
	): Promise<Connection> {
		// Capture the manifest pid *before* stop() — stop() removes the manifest
		// for tracked instances and only sends SIGTERM, which a wedged process
		// can ignore. We escalate to SIGKILL on whatever pid the manifest named.
		const preferredPorts = this.getPreferredPorts(organizationId);
		const manifestPid = readManifest(organizationId)?.pid;

		this.stop(organizationId);

		if (manifestPid != null && isProcessAlive(manifestPid)) {
			try {
				killProcess(manifestPid, "SIGKILL");
			} catch (error) {
				log.warn(
					`[host-service:${organizationId}] reset: SIGKILL of pid=${manifestPid} failed`,
					error,
				);
			}
		}

		removeManifest(organizationId);

		return this.startWithPreferredPorts(organizationId, config, preferredPorts);
	}

	getConnection(organizationId: string): Connection | null {
		const instance = this.instances.get(organizationId);
		if (!instance || instance.status !== "running") return null;
		return {
			port: instance.port,
			secret: instance.secret,
			machineId: this.machineId,
		};
	}

	getProcessStatus(organizationId: string): HostServiceStatus {
		if (this.pendingStarts.has(organizationId)) return "starting";
		return this.instances.get(organizationId)?.status ?? "stopped";
	}

	getActiveOrganizationIds(): string[] {
		return [...this.instances.entries()]
			.filter(([, i]) => i.status !== "stopped")
			.map(([id]) => id);
	}

	async restartAll(config: SpawnConfig): Promise<void> {
		await Promise.all(
			this.getActiveOrganizationIds().map((orgId) =>
				this.restart(orgId, config),
			),
		);
	}

	/**
	 * Dev-only: watch the built host-service bundle and restart running
	 * instances when it changes. Gives a fast edit→reload loop for code
	 * under packages/host-service and src/main/host-service without
	 * restarting Electron. In-memory host-service state (PTYs, watchers,
	 * chat streams) is torn down on each reload — this is not true HMR.
	 */
	enableDevReload(
		configProvider: () => Promise<SpawnConfig | null>,
	): () => void {
		if (this.devReloadWatcher) return () => {};

		const scriptDir = path.dirname(this.scriptPath);
		const scriptFile = path.basename(this.scriptPath);
		let debounce: ReturnType<typeof setTimeout> | null = null;
		let reloading = false;

		const waitForStableBundle = async (): Promise<boolean> => {
			const deadline = Date.now() + 5_000;
			let lastSize = -1;
			let stableSince = 0;
			while (Date.now() < deadline) {
				try {
					const stat = fs.statSync(this.scriptPath);
					if (stat.size > 0 && stat.size === lastSize) {
						if (Date.now() - stableSince >= 150) return true;
					} else {
						lastSize = stat.size;
						stableSince = Date.now();
					}
				} catch {
					lastSize = -1;
					stableSince = 0;
				}
				await new Promise((r) => setTimeout(r, 50));
			}
			return false;
		};

		const trigger = () => {
			if (debounce) clearTimeout(debounce);
			debounce = setTimeout(() => {
				void (async () => {
					if (reloading) return;
					if (this.getActiveOrganizationIds().length === 0) return;
					reloading = true;
					try {
						const ready = await waitForStableBundle();
						if (!ready) {
							log.warn(
								"[host-service] bundle did not stabilize, skipping reload",
							);
							return;
						}
						const config = await configProvider();
						if (!config) return;
						log.info(
							"[host-service] bundle changed, restarting running instances",
						);
						await this.restartAll(config);
					} catch (error) {
						log.error("[host-service] dev reload failed:", error);
					} finally {
						reloading = false;
					}
				})();
			}, 250);
		};

		try {
			this.devReloadWatcher = fs.watch(scriptDir, (_event, filename) => {
				if (filename && filename !== scriptFile) return;
				trigger();
			});
		} catch (error) {
			log.error("[host-service] failed to enable dev reload:", error);
			return () => {};
		}

		return () => {
			if (debounce) clearTimeout(debounce);
			this.devReloadWatcher?.close();
			this.devReloadWatcher = null;
		};
	}

	// ── Spawn ─────────────────────────────────────────────────────────

	private async spawn(
		organizationId: string,
		config: SpawnConfig,
		preferredPorts: Iterable<number> = this.getPreferredPorts(organizationId),
	): Promise<Connection> {
		const port = await findFreePort(preferredPorts);
		this.rememberPort(organizationId, port);
		const secret = randomBytes(32).toString("hex");

		const instance: HostServiceProcess = {
			pid: 0,
			port,
			secret,
			status: "starting",
		};
		this.instances.set(organizationId, instance);
		this.emitStatus(organizationId, "starting", null);

		const childEnv = await this.buildEnv(organizationId, port, secret, config);
		const logFd = openRotatingLogFd(
			path.join(manifestDir(organizationId), "host-service.log"),
			MAX_HOST_LOG_BYTES,
		);
		// Dev: pipe child stdout/stderr through this process so log lines
		// land in the developer's `bun dev` terminal. Production: hard-back
		// stdio with the rotating log file.
		const isDev = !app.isPackaged;
		const stdio: childProcess.StdioOptions = isDev
			? ["ignore", "pipe", "pipe"]
			: logFd >= 0
				? ["ignore", logFd, logFd]
				: ["ignore", "ignore", "ignore"];

		let child: ReturnType<typeof childProcess.spawn>;
		try {
			child = childProcess.spawn(process.execPath, [this.scriptPath], {
				detached: false,
				stdio,
				env: childEnv,
				// Avoid a flashing CMD window on Windows.
				windowsHide: true,
			});
		} finally {
			if (logFd >= 0) {
				try {
					fs.closeSync(logFd);
				} catch {
					// Best-effort — child has its own dup of the fd.
				}
			}
		}

		// In dev, fan child output through to parent stdout/stderr with a
		// prefix so it's identifiable in `bun dev`.
		if (isDev && child.stdout && child.stderr) {
			const tag = `[hs:${organizationId.slice(0, 8)}]`;
			pipeWithPrefix(child.stdout, process.stdout, tag);
			pipeWithPrefix(child.stderr, process.stderr, tag);
		}

		const childPid = child.pid;
		if (!childPid) {
			this.instances.delete(organizationId);
			throw new Error("Failed to spawn host service process");
		}

		instance.pid = childPid;
		child.on("exit", (code, signal) => {
			log.info(
				`[host-service:${organizationId}] exited with code ${code} signal ${signal}`,
			);
			const current = this.instances.get(organizationId);
			if (!current || current.pid !== childPid || current.status === "stopped")
				return;

			// Only supervise a crash of a running child; startup deaths surface
			// via start()'s rejection instead.
			const previousStatus = current.status;
			this.rememberPort(organizationId, current.port);
			this.instances.delete(organizationId);
			removeManifest(organizationId);
			this.emitStatus(organizationId, "stopped", previousStatus);

			if (previousStatus === "running") {
				this.superviseCrash(organizationId, config, code, signal);
			}
		});
		// Don't let the child block Electron's exit — stopAll() handles teardown.
		child.unref();

		const endpoint = `http://127.0.0.1:${port}`;
		const healthy = await pollHealthCheck(endpoint, secret);
		if (!healthy) {
			child.kill("SIGTERM");
			this.instances.delete(organizationId);
			throw new Error(
				`Host service failed to start within ${HEALTH_POLL_TIMEOUT_MS}ms`,
			);
		}

		instance.status = "running";

		log.info(`[host-service:${organizationId}] listening on port ${port}`);
		this.emitStatus(organizationId, "running", "starting");
		return { port, secret, machineId: this.machineId };
	}

	private async buildEnv(
		organizationId: string,
		port: number,
		secret: string,
		config: SpawnConfig,
	): Promise<Record<string, string>> {
		const organizationDir = manifestDir(organizationId);
		const row = localDb.select().from(settings).get();
		const exposeViaRelay = row?.exposeHostServiceViaRelay ?? false;

		const childEnv = await getProcessEnvWithShellPath({
			...(process.env as Record<string, string>),
			ELECTRON_RUN_AS_NODE: "1",
			NODE_ENV: app.isPackaged
				? "production"
				: (process.env.NODE_ENV ?? "development"),
			ORGANIZATION_ID: organizationId,
			HOST_CLIENT_ID: getHostId(),
			HOST_NAME: getHostName(),
			HOST_SERVICE_SECRET: secret,
			HOST_SERVICE_PORT: String(port),
			HOST_MANIFEST_DIR: organizationDir,
			HOST_DB_PATH: path.join(organizationDir, "host.db"),
			HOST_MIGRATIONS_FOLDER: app.isPackaged
				? path.join(process.resourcesPath, "resources/host-migrations")
				: path.join(app.getAppPath(), "../../packages/host-service/drizzle"),
			DESKTOP_VITE_PORT: String(sharedEnv.DESKTOP_VITE_PORT),
			SUPERSET_HOME_DIR: SUPERSET_HOME_DIR,
			SUPERSET_LEGACY_WORKTREE_BASE_DIR: row?.worktreeBaseDir ?? "",
			SUPERSET_AGENT_HOOK_PORT: String(sharedEnv.DESKTOP_NOTIFICATIONS_PORT),
			SUPERSET_AGENT_HOOK_VERSION: HOOK_PROTOCOL_VERSION,
			AUTH_TOKEN: config.authToken,
			SUPERSET_AUTH_CONFIG_PATH: path.join(SUPERSET_HOME_DIR, "config.json"),
			SUPERSET_API_URL: config.cloudApiUrl,
			// Pre-release ACP session harness, internal-channel only: enabled on
			// canary and dev builds, never on stable. The host gates its router
			// and WS stream route on this env var.
			...(isInternalBuild() ? { SUPERSET_ACP_SESSIONS: "1" } : {}),
			// Local-only mode: the child's cloud api client becomes a stub and
			// cloud mirroring is skipped entirely.
			...(config.localOnly ? { SUPERSET_LOCAL_ONLY: "1" } : {}),
			// Read by the child's parent watchdog so it can self-exit if
			// Electron crashes without sending SIGTERM (orphan reparenting).
			HOST_PARENT_PID: String(process.pid),
		});

		// `getProcessEnvWithShellPath` merges in the user's interactive shell env,
		// which in dev has `RELAY_URL` set. Enforce the toggle *after* that merge
		// so the child definitely doesn't see a relay URL when disabled. The
		// effective URL comes from the PostHog `relay-url-override` flag with
		// `env.RELAY_URL` as fallback (see main/lib/relay-url) so we can A/B-test
		// alternate relay deployments per-user.
		const effectiveRelayUrl = await getRelayUrl();
		if (exposeViaRelay && effectiveRelayUrl && !config.localOnly) {
			childEnv.RELAY_URL = effectiveRelayUrl;
		} else {
			delete childEnv.RELAY_URL;
		}

		return childEnv;
	}

	// ── Events ────────────────────────────────────────────────────────

	private emitStatus(
		organizationId: string,
		status: HostServiceStatus,
		previousStatus: HostServiceStatus | null,
	): void {
		this.emit("status-changed", {
			organizationId,
			status,
			previousStatus,
		} satisfies HostServiceStatusEvent);
	}

	/**
	 * A running host-service child died unexpectedly (not via stop()). These
	 * are native crashes the child can't catch — see planHostServiceRestart.
	 * Respawn it so the renderer's getConnection poll reconnects automatically;
	 * the surviving pty-daemon keeps the user's shells alive across the swap.
	 * Back off on a crash loop and surface a throttled, honest alert.
	 */
	private superviseCrash(
		organizationId: string,
		config: SpawnConfig,
		code: number | null,
		signal: NodeJS.Signals | null,
	): void {
		if (this.shuttingDown) return;

		const now = Date.now();
		const plan = planHostServiceRestart({
			recentCrashTimestamps: this.crashTimes.get(organizationId) ?? [],
			now,
		});
		this.crashTimes.set(organizationId, plan.retained);

		const cause =
			signal != null ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
		log.error(
			`[host-service:${organizationId}] crashed (${cause}); ` +
				`${plan.looping ? `crash loop — backing off ${RESTART_BACKOFF_MS}ms` : "auto-restarting"} ` +
				`(${plan.crashesInWindow} crash(es) in ${CRASH_WINDOW_MS / 1000}s)`,
		);

		if (plan.looping) this.maybeAlertCrashLoop(organizationId, cause);

		this.clearRestartTimer(organizationId);
		const timer = setTimeout(() => {
			this.restartTimers.delete(organizationId);
			if (this.shuttingDown) return;
			// Skip if something already brought the org back (a manual restart or
			// the renderer's start effect) while we were waiting.
			if (this.instances.has(organizationId)) return;
			void this.startWithPreferredPorts(
				organizationId,
				config,
				this.getPreferredPorts(organizationId),
			).catch((err) => {
				log.error(
					`[host-service:${organizationId}] auto-restart failed:`,
					err,
				);
			});
		}, plan.delayMs);
		// Don't let a queued restart keep the event loop (and the app) alive.
		timer.unref();
		this.restartTimers.set(organizationId, timer);
	}

	private clearRestartTimer(organizationId: string): void {
		const timer = this.restartTimers.get(organizationId);
		if (timer) {
			clearTimeout(timer);
			this.restartTimers.delete(organizationId);
		}
	}

	/**
	 * Surface a persistent crash loop to the user — throttled so a fast loop
	 * can't spam modal dialogs. We still keep auto-restarting in the
	 * background; this only tells the user the service is unstable and that a
	 * full app relaunch is the fallback (there is no tray on Windows).
	 */
	private maybeAlertCrashLoop(organizationId: string, cause: string): void {
		const now = Date.now();
		const last = this.lastCrashAlertAt.get(organizationId) ?? 0;
		if (now - last < CRASH_LOOP_ALERT_THROTTLE_MS) return;
		this.lastCrashAlertAt.set(organizationId, now);
		dialog.showErrorBox(
			"Host service keeps crashing",
			`Superset's host service for this organization has crashed repeatedly (${cause}) and is being restarted automatically. Your terminals keep running in the background. If workspaces stay unavailable, quit and reopen Superset.`,
		);
	}
}

/**
 * Forward child stdout/stderr to a parent stream with a per-line prefix.
 * Plain `chunk => parent.write(`${tag} ${chunk}`)` only prefixes the first
 * line in a chunk and breaks visual scanning when child output bursts.
 */
function pipeWithPrefix(
	source: NodeJS.ReadableStream,
	target: NodeJS.WritableStream,
	tag: string,
): void {
	let pending = "";
	source.on("data", (chunk: Buffer) => {
		const text = pending + chunk.toString("utf8");
		const lines = text.split("\n");
		// Last element is a partial line if input doesn't end with \n;
		// stash it for the next chunk.
		pending = lines.pop() ?? "";
		for (const line of lines) {
			target.write(`${tag} ${line}\n`);
		}
	});
	source.on("end", () => {
		if (pending) target.write(`${tag} ${pending}\n`);
		pending = "";
	});
}

let coordinator: HostServiceCoordinator | null = null;

export function getHostServiceCoordinator(): HostServiceCoordinator {
	if (!coordinator) {
		coordinator = new HostServiceCoordinator();
	}
	return coordinator;
}
