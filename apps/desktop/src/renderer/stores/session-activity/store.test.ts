import { afterEach, describe, expect, it } from "bun:test";
import {
	clearSessionActivity,
	getSessionActivity,
	getSessionActivityVersion,
	getSessionPaneIdsForWorkspace,
	getSessionWorkspaceEntries,
	publishSessionActivity,
	registerSessionWorkspace,
	resetSessionActivity,
	subscribeSessionActivity,
} from "./store";

afterEach(() => {
	resetSessionActivity();
});

describe("session activity store", () => {
	it("round-trips a pane's activity", () => {
		publishSessionActivity("pane-1", {
			status: "streaming",
			turnKey: undefined,
		});
		expect(getSessionActivity("pane-1")).toEqual({
			status: "streaming",
			turnKey: undefined,
		});
	});

	/**
	 * The session store calls publish on EVERY snapshot change, which during a
	 * stream is every token. Without this guard each one would repaint every
	 * tab in the workspace.
	 */
	it("does not notify when nothing changed", () => {
		let notifications = 0;
		const unsubscribe = subscribeSessionActivity(() => {
			notifications++;
		});
		publishSessionActivity("pane-1", {
			status: "streaming",
			turnKey: undefined,
		});
		publishSessionActivity("pane-1", {
			status: "streaming",
			turnKey: undefined,
		});
		publishSessionActivity("pane-1", {
			status: "streaming",
			turnKey: undefined,
		});
		expect(notifications).toBe(1);
		unsubscribe();
	});

	it("notifies when the status changes", () => {
		let notifications = 0;
		const unsubscribe = subscribeSessionActivity(() => {
			notifications++;
		});
		publishSessionActivity("pane-1", {
			status: "streaming",
			turnKey: undefined,
		});
		publishSessionActivity("pane-1", { status: "done", turnKey: "turn-1" });
		expect(notifications).toBe(2);
		unsubscribe();
	});

	/** A back-to-back turn keeps the status but must still count as new. */
	it("notifies when only the turn key changes", () => {
		publishSessionActivity("pane-1", { status: "done", turnKey: "turn-1" });
		const before = getSessionActivityVersion();
		publishSessionActivity("pane-1", { status: "done", turnKey: "turn-2" });
		expect(getSessionActivityVersion()).toBeGreaterThan(before);
	});

	it("maps panes to workspaces", () => {
		registerSessionWorkspace("pane-1", "ws-a");
		registerSessionWorkspace("pane-2", "ws-a");
		registerSessionWorkspace("pane-3", "ws-b");
		expect(getSessionPaneIdsForWorkspace("ws-a").sort()).toEqual([
			"pane-1",
			"pane-2",
		]);
		expect(getSessionPaneIdsForWorkspace("ws-b")).toEqual(["pane-3"]);
		expect(getSessionWorkspaceEntries()).toHaveLength(3);
	});

	it("ignores a repeat registration", () => {
		registerSessionWorkspace("pane-1", "ws-a");
		const before = getSessionActivityVersion();
		registerSessionWorkspace("pane-1", "ws-a");
		expect(getSessionActivityVersion()).toBe(before);
	});

	/**
	 * A closed pane that kept either half of its state would keep being counted
	 * by the workspace rollup and the dock badge.
	 */
	it("clears both the activity and the workspace mapping", () => {
		registerSessionWorkspace("pane-1", "ws-a");
		publishSessionActivity("pane-1", { status: "done", turnKey: "turn-1" });
		clearSessionActivity("pane-1");
		expect(getSessionActivity("pane-1")).toBeUndefined();
		expect(getSessionPaneIdsForWorkspace("ws-a")).toEqual([]);
	});

	it("clears a pane that only ever registered a workspace", () => {
		registerSessionWorkspace("pane-1", "ws-a");
		const before = getSessionActivityVersion();
		clearSessionActivity("pane-1");
		expect(getSessionActivityVersion()).toBeGreaterThan(before);
		expect(getSessionPaneIdsForWorkspace("ws-a")).toEqual([]);
	});

	it("is a no-op clearing a pane it never knew about", () => {
		const before = getSessionActivityVersion();
		clearSessionActivity("nobody");
		expect(getSessionActivityVersion()).toBe(before);
	});
});
