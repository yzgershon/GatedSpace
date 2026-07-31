import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { SUPERSET_HOME_DIR } from "./app-environment";

export interface HostServiceManifest {
	pid: number;
	endpoint: string;
	authToken: string;
	startedAt: number;
	organizationId: string;
}

/**
 * The per-org database the host service creates. Used as the marker for "this
 * machine has run this org", because unlike the manifest it is not deleted when
 * the service stops.
 */
const HOST_DB_FILENAME = "host.db";

/** Record of a CURRENTLY RUNNING service. Deleted by `stop()`. */
const MANIFEST_FILENAME = "manifest.json";

export function manifestDir(organizationId: string): string {
	return join(SUPERSET_HOME_DIR, "host", organizationId);
}

function manifestPath(organizationId: string): string {
	return join(manifestDir(organizationId), MANIFEST_FILENAME);
}

export function writeManifest(manifest: HostServiceManifest): void {
	const dir = manifestDir(manifest.organizationId);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
	}
	writeFileSync(
		manifestPath(manifest.organizationId),
		JSON.stringify(manifest),
		{
			encoding: "utf-8",
			mode: 0o600,
		},
	);
}

export function readManifest(
	organizationId: string,
): HostServiceManifest | null {
	const filePath = manifestPath(organizationId);
	if (!existsSync(filePath)) return null;

	try {
		const raw = readFileSync(filePath, "utf-8");
		const data = JSON.parse(raw);

		if (
			typeof data.pid !== "number" ||
			typeof data.endpoint !== "string" ||
			typeof data.authToken !== "string" ||
			typeof data.startedAt !== "number" ||
			typeof data.organizationId !== "string"
		) {
			return null;
		}

		return data as HostServiceManifest;
	} catch {
		return null;
	}
}

/**
 * Orgs that have run a host service on this machine before.
 *
 * Exists so main can start the host service at launch WITHOUT a session. The
 * org id otherwise only arrives with the renderer's auth hydration, which costs
 * two network round-trips — and the host service takes several seconds to spawn,
 * so waiting for the network to learn something already on disk put the slowest
 * step behind one of the most variable ones.
 *
 * Disk is the honest source here: a directory exists only because this machine
 * actually ran that org. A fresh install returns nothing, which is correct — we
 * genuinely do not know yet, and the renderer asks once it does.
 */
export function listKnownOrganizationIds(): string[] {
	return listKnownOrganizationIdsIn(join(SUPERSET_HOME_DIR, "host"));
}

/**
 * The rule, against an explicit root so it can be tested.
 *
 * Separated for exactly one reason: the first version could not be tested
 * against the state that mattered. It filtered on `manifest.json`, which made it
 * match nothing at launch and the prewarm silently do nothing — and checking it
 * against a RUNNING app passed, because that is precisely when the manifest
 * exists. A rule about launch-time state has to be checkable at launch-time
 * state.
 *
 * `host.db` is the durable marker: it exists because the host service really ran
 * for that org, and it survives quitting. `manifest.json` is accepted too, which
 * only adds the case where a service is currently running — harmless, since
 * `start` returns the live connection for an org already up. Permissive on
 * purpose: a false positive costs one redundant idempotent call, a false
 * negative costs the entire head start.
 */
export function listKnownOrganizationIdsIn(root: string): string[] {
	try {
		return readdirSync(root, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.filter(
				(entry) =>
					existsSync(join(root, entry.name, HOST_DB_FILENAME)) ||
					existsSync(join(root, entry.name, MANIFEST_FILENAME)),
			)
			.map((entry) => entry.name);
	} catch {
		// No host dir yet (first run) — nothing known, which is a real answer.
		return [];
	}
}

export function removeManifest(organizationId: string): void {
	const filePath = manifestPath(organizationId);
	try {
		if (existsSync(filePath)) {
			unlinkSync(filePath);
		}
	} catch {
		// Best-effort removal
	}
}

/** Check whether a process with the given PID is alive. */
export function isProcessAlive(pid: number): boolean {
	if (!isSignalablePid(pid)) return false;

	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export function killProcess(
	pid: number,
	signal: NodeJS.Signals | number,
): void {
	if (!isSignalablePid(pid)) {
		throw new Error(`Refusing to signal invalid pid: ${pid}`);
	}

	process.kill(pid, signal);
}

function isSignalablePid(pid: number): boolean {
	return Number.isInteger(pid) && Number.isFinite(pid) && pid > 1;
}
