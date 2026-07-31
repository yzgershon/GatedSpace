import { describe, expect, test } from "bun:test";
import { isHostWorkspacesReady } from "./useHostWorkspaces.utils";

describe("isHostWorkspacesReady", () => {
	test("is NOT ready before the host service has been asked to start", () => {
		// THE regression, and the one that survived the first attempt at this fix.
		// At cold launch nothing has started yet, so no host has been discovered,
		// so the settlement check runs over an empty array — and `[].every()` is
		// true. Reporting ready here is what made a restored workspace route
		// render "Workspace not found" on every single launch.
		expect(
			isHostWorkspacesReady({
				targetsSettled: true,
				activeHostUrl: null,
				hostServiceSettled: false,
			}),
		).toBe(false);
	});

	test("is ready once the local host URL is known and queries settled", () => {
		expect(
			isHostWorkspacesReady({
				targetsSettled: true,
				activeHostUrl: "http://127.0.0.1:55155",
				hostServiceSettled: true,
			}),
		).toBe(true);
	});

	test("stays not-ready while a discovered host is still in flight", () => {
		expect(
			isHostWorkspacesReady({
				targetsSettled: false,
				activeHostUrl: "http://127.0.0.1:55155",
				hostServiceSettled: true,
			}),
		).toBe(false);
	});

	test("does not hang forever when the host service fails to start", () => {
		// Settled without a URL means we tried and it did not work. Showing the
		// real (empty) state plus the provider's error beats a spinner that never
		// resolves.
		expect(
			isHostWorkspacesReady({
				targetsSettled: true,
				activeHostUrl: null,
				hostServiceSettled: true,
			}),
		).toBe(true);
	});

	test("a URL alone is enough — settlement of the start is not required", () => {
		// The connection can be seeded from the start mutation's own result before
		// its onSettled has run. Having the port IS the answer.
		expect(
			isHostWorkspacesReady({
				targetsSettled: true,
				activeHostUrl: "http://127.0.0.1:55155",
				hostServiceSettled: false,
			}),
		).toBe(true);
	});
});
