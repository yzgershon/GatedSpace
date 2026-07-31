/**
 * The bug being pinned down: the host-service prewarm silently did nothing on
 * every launch.
 *
 * It looked for orgs by checking for `manifest.json`, which is a record of a
 * RUNNING service — `stop()` deletes it, so a clean quit removes it, so it is
 * never present at the moment the prewarm looks. The check was verified against
 * a running app, which is the one state where it happens to pass. The result was
 * an empty org list, an early return, and no log line to say so.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listKnownOrganizationIdsIn } from "./host-service-manifest";

let root: string;

function org(name: string, files: string[]): void {
	const dir = join(root, name);
	mkdirSync(dir, { recursive: true });
	for (const file of files) writeFileSync(join(dir, file), "x");
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "superset-host-manifest-"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("listKnownOrganizationIdsIn", () => {
	test("finds an org that has run but is NOT running — the launch-time state", () => {
		// The regression. At launch there is no manifest, because the last clean
		// quit deleted it. The database is what remains.
		org("org-a", ["host.db", "host-service.log"]);
		expect(listKnownOrganizationIdsIn(root)).toEqual(["org-a"]);
	});

	test("finds an org that is currently running", () => {
		org("org-b", ["host.db", "manifest.json"]);
		expect(listKnownOrganizationIdsIn(root)).toEqual(["org-b"]);
	});

	test("ignores a directory that never hosted a service", () => {
		// A partial mkdir, or a dir left behind with only logs in it. Prewarming
		// it would spawn a service for an org this machine has never served.
		org("org-c", ["host-service.log"]);
		expect(listKnownOrganizationIdsIn(root)).toEqual([]);
	});

	test("returns nothing on a first-ever launch instead of throwing", () => {
		// The host dir does not exist yet. Empty is the correct answer, and the
		// caller treats it as "nothing to prewarm" rather than an error.
		expect(listKnownOrganizationIdsIn(join(root, "does-not-exist"))).toEqual(
			[],
		);
	});

	test("finds every org on a machine that has served several", () => {
		org("org-a", ["host.db"]);
		org("org-b", ["host.db"]);
		expect(listKnownOrganizationIdsIn(root).sort()).toEqual(["org-a", "org-b"]);
	});
});
