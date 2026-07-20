import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	test,
} from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import path from "node:path";

const APP_VERSION = "1.2.3";
let killedPids: Array<{ pid: number; signal: NodeJS.Signals | number }> = [];
let killProcessError: NodeJS.ErrnoException | null = null;

const manifestStore: {
	current: {
		pid: number;
		endpoint: string;
		authToken: string;
		startedAt: number;
		organizationId: string;
	} | null;
} = { current: null };

let testManifestRoot = "";

const readManifestMock = mock(() => manifestStore.current);
const removeManifestMock = mock(() => {
	manifestStore.current = null;
});
const isProcessAliveMock = mock(() => true);
const killProcessMock = mock((pid: number, signal: NodeJS.Signals | number) => {
	if (killProcessError) {
		const error = killProcessError;
		killProcessError = null;
		throw error;
	}
	killedPids.push({ pid, signal });
});

const realHostServiceManifest = await import("./host-service-manifest");
mock.module("./host-service-manifest", () => ({
	...realHostServiceManifest,
	readManifest: readManifestMock,
	removeManifest: removeManifestMock,
	isProcessAlive: isProcessAliveMock,
	killProcess: killProcessMock,
	manifestDir: (orgId: string) => path.join(testManifestRoot, orgId),
}));

const pollHealthCheckMock = mock(() => Promise.resolve(true));

const realHostServiceUtils = await import("./host-service-utils");
mock.module("./host-service-utils", () => ({
	...realHostServiceUtils,
	HEALTH_POLL_TIMEOUT_MS: 10_000,
	MAX_HOST_LOG_BYTES: 1024,
	findFreePort: mock(() => Promise.resolve(40000)),
	openRotatingLogFd: mock(() => -1),
	pollHealthCheck: pollHealthCheckMock,
}));

mock.module("electron", () => ({
	app: {
		getVersion: () => APP_VERSION,
		isPackaged: false,
		getAppPath: () => "/tmp/app",
	},
	dialog: {
		showErrorBox: mock(),
	},
}));

mock.module("electron-log/main", () => ({
	default: {
		info: () => {},
		warn: () => {},
		error: () => {},
	},
}));

const realHostInfo = await import("@superset/shared/host-info");
mock.module("@superset/shared/host-info", () => ({
	...realHostInfo,
	getHostId: () => "host-1",
	getHostName: () => "host",
}));
mock.module("./local-db", () => ({
	localDb: {
		select: () => ({ from: () => ({ get: () => null }) }),
	},
}));

const { HostServiceCoordinator, planHostServiceRestart } = await import(
	"./host-service-coordinator"
);

const baseManifest = (pid: number, endpoint = "http://127.0.0.1:55555") => ({
	pid,
	endpoint,
	authToken: "manifest-secret",
	startedAt: 0,
	organizationId: "org-1",
});

const spawnConfig = { authToken: "token", cloudApiUrl: "https://api.example" };

interface HostServiceCoordinatorInternals {
	getPreferredPorts(organizationId: string): number[];
	rememberPort(organizationId: string, port: number): void;
}

function resetMocks(): void {
	manifestStore.current = null;
	readManifestMock.mockClear();
	removeManifestMock.mockClear();
	isProcessAliveMock.mockClear();
	killProcessMock.mockClear();
	pollHealthCheckMock.mockClear();
	killedPids = [];
	killProcessError = null;
}

describe("HostServiceCoordinator preferred ports", () => {
	let coordinator: InstanceType<typeof HostServiceCoordinator>;

	beforeEach(() => {
		resetMocks();
		testManifestRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hsc-test-"));
		coordinator = new HostServiceCoordinator();
	});

	afterEach(() => {
		coordinator.stopAll();
		if (testManifestRoot) {
			fs.rmSync(testManifestRoot, { recursive: true, force: true });
			testManifestRoot = "";
		}
	});

	test("prefers the last known port, then a stable org port", () => {
		const internals = coordinator as unknown as HostServiceCoordinatorInternals;
		internals.rememberPort("org-1", 46666);

		const ports = internals.getPreferredPorts("org-1");

		expect(ports[0]).toBe(46666);
		expect(ports[1]).toBeGreaterThanOrEqual(48_000);
		expect(ports[1]).toBeLessThan(49_000);
	});

	test("uses a deterministic stable port when no previous port exists", () => {
		const internals = coordinator as unknown as HostServiceCoordinatorInternals;

		const ports = internals.getPreferredPorts("org-1");
		const secondRead = internals.getPreferredPorts("org-1");

		expect(ports).toEqual(secondRead);
		expect(ports).toHaveLength(1);
		expect(ports[0]).toBeGreaterThanOrEqual(48_000);
		expect(ports[0]).toBeLessThan(49_000);
	});
});

describe("HostServiceCoordinator.reset", () => {
	let coordinator: InstanceType<typeof HostServiceCoordinator>;
	let spawnMock: ReturnType<typeof mock>;

	beforeEach(() => {
		resetMocks();
		testManifestRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hsc-test-"));

		coordinator = new HostServiceCoordinator();
		spawnMock = mock(async () => ({
			port: 60000,
			secret: "fresh-secret",
			machineId: "host-1",
		}));
		(coordinator as unknown as { spawn: typeof spawnMock }).spawn = spawnMock;
	});

	afterEach(() => {
		coordinator.stopAll();
		if (testManifestRoot) {
			fs.rmSync(testManifestRoot, { recursive: true, force: true });
			testManifestRoot = "";
		}
	});

	test("removes manifest, SIGKILLs live pid, then spawns fresh", async () => {
		manifestStore.current = baseManifest(8888);

		const conn = await coordinator.reset("org-1", spawnConfig);

		expect(killedPids).toContainEqual({ pid: 8888, signal: "SIGKILL" });
		expect(removeManifestMock).toHaveBeenCalled();
		expect(spawnMock).toHaveBeenCalledTimes(1);
		expect(conn.port).toBe(60000);
		expect(conn.secret).toBe("fresh-secret");
	});

	test("swallows SIGKILL ESRCH (pid already gone) and still respawns", async () => {
		manifestStore.current = baseManifest(7777);
		const err: NodeJS.ErrnoException = new Error("kill ESRCH");
		err.code = "ESRCH";
		killProcessError = err;

		const conn = await coordinator.reset("org-1", spawnConfig);

		expect(killProcessMock).toHaveBeenCalledWith(7777, "SIGKILL");
		expect(removeManifestMock).toHaveBeenCalled();
		expect(spawnMock).toHaveBeenCalledTimes(1);
		expect(conn.port).toBe(60000);
	});

	test("is safe when no manifest exists — no kill, still spawns", async () => {
		manifestStore.current = null;

		const conn = await coordinator.reset("org-1", spawnConfig);

		expect(killedPids).toHaveLength(0);
		// removeManifest is called unconditionally — that's fine, the impl
		// in host-service-manifest treats a missing file as a no-op.
		expect(removeManifestMock).toHaveBeenCalled();
		expect(spawnMock).toHaveBeenCalledTimes(1);
		expect(conn.port).toBe(60000);
	});

	test("skips SIGKILL when the manifest pid is no longer alive", async () => {
		manifestStore.current = baseManifest(9999);
		isProcessAliveMock.mockImplementationOnce(() => false);

		const conn = await coordinator.reset("org-1", spawnConfig);

		expect(killedPids).toHaveLength(0);
		expect(spawnMock).toHaveBeenCalledTimes(1);
		expect(conn.port).toBe(60000);
	});
});

describe("planHostServiceRestart", () => {
	const opts = { budget: 3, windowMs: 60_000, backoffMs: 15_000 };

	test("first crash restarts immediately and records the timestamp", () => {
		const plan = planHostServiceRestart({
			recentCrashTimestamps: [],
			now: 1_000,
			...opts,
		});
		expect(plan.delayMs).toBe(0);
		expect(plan.looping).toBe(false);
		expect(plan.crashesInWindow).toBe(1);
		expect(plan.retained).toEqual([1_000]);
	});

	test("crashes up to the budget all restart immediately", () => {
		const plan = planHostServiceRestart({
			recentCrashTimestamps: [1_000, 2_000],
			now: 3_000,
			...opts,
		});
		expect(plan.delayMs).toBe(0);
		expect(plan.looping).toBe(false);
		expect(plan.crashesInWindow).toBe(3);
		expect(plan.retained).toEqual([1_000, 2_000, 3_000]);
	});

	test("exceeding the budget within the window backs off and resets the window", () => {
		const plan = planHostServiceRestart({
			recentCrashTimestamps: [1_000, 2_000, 3_000],
			now: 4_000,
			...opts,
		});
		expect(plan.delayMs).toBe(15_000);
		expect(plan.looping).toBe(true);
		expect(plan.crashesInWindow).toBe(4);
		// Window reset so the next loop earns a fresh budget rather than
		// compounding into ever-longer counts.
		expect(plan.retained).toEqual([]);
	});

	test("crashes older than the window are dropped, so slow crashes never loop", () => {
		const plan = planHostServiceRestart({
			recentCrashTimestamps: [1_000, 2_000, 3_000],
			now: 100_000,
			...opts,
		});
		expect(plan.delayMs).toBe(0);
		expect(plan.looping).toBe(false);
		expect(plan.crashesInWindow).toBe(1);
		expect(plan.retained).toEqual([100_000]);
	});
});

describe("HostServiceCoordinator.superviseCrash", () => {
	let coordinator: InstanceType<typeof HostServiceCoordinator>;
	let startMock: ReturnType<typeof mock>;

	interface SuperviseInternals {
		superviseCrash(
			organizationId: string,
			config: typeof spawnConfig,
			code: number | null,
			signal: NodeJS.Signals | null,
		): void;
		startWithPreferredPorts: ReturnType<typeof mock>;
		shuttingDown: boolean;
	}

	beforeEach(() => {
		resetMocks();
		testManifestRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hsc-test-"));
		coordinator = new HostServiceCoordinator();
		startMock = mock(async () => ({
			port: 40000,
			secret: "s",
			machineId: "host-1",
		}));
		(coordinator as unknown as SuperviseInternals).startWithPreferredPorts =
			startMock;
	});

	afterEach(() => {
		coordinator.stopAll();
		if (testManifestRoot) {
			fs.rmSync(testManifestRoot, { recursive: true, force: true });
			testManifestRoot = "";
		}
	});

	test("a native crash schedules an automatic respawn", async () => {
		(coordinator as unknown as SuperviseInternals).superviseCrash(
			"org-1",
			spawnConfig,
			3_221_225_477,
			null,
		);
		await new Promise((r) => setTimeout(r, 25));
		expect(startMock).toHaveBeenCalledTimes(1);
	});

	test("does not respawn once the app is shutting down", async () => {
		(coordinator as unknown as SuperviseInternals).shuttingDown = true;
		(coordinator as unknown as SuperviseInternals).superviseCrash(
			"org-1",
			spawnConfig,
			139,
			null,
		);
		await new Promise((r) => setTimeout(r, 25));
		expect(startMock).not.toHaveBeenCalled();
	});

	test("stopAll cancels a queued restart so no child outlives quit", async () => {
		const internals = coordinator as unknown as SuperviseInternals;
		internals.superviseCrash("org-1", spawnConfig, 3_221_226_356, null);
		coordinator.stopAll();
		await new Promise((r) => setTimeout(r, 25));
		expect(startMock).not.toHaveBeenCalled();
	});
});

afterAll(() => {
	mock.restore();
});
