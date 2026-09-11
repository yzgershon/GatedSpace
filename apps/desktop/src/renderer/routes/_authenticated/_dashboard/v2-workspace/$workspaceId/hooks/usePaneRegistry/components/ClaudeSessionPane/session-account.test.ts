import { beforeEach, describe, expect, test } from "bun:test";
import {
	clearPinnedAccount,
	forgetPinnedAccount,
	getPinnedAccount,
	setPinnedAccount,
	subscribePinnedAccount,
} from "./session-account";

/** A minimal localStorage, since bun's test env has no DOM. */
function installStorage(): Map<string, string> {
	const store = new Map<string, string>();
	(globalThis as { localStorage?: unknown }).localStorage = {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => {
			store.set(k, v);
		},
		removeItem: (k: string) => {
			store.delete(k);
		},
	};
	return store;
}

const AMITAI = {
	id: "amitai",
	label: "Amitai",
	configDir: "C:\\Users\\me\\.claude-amitai",
};

describe("session account pins", () => {
	let store: Map<string, string>;
	beforeEach(() => {
		store = installStorage();
		forgetPinnedAccount("pane-1");
		forgetPinnedAccount("pane-2");
	});

	test("no pin means follow the global account", () => {
		expect(getPinnedAccount("pane-1")).toBeNull();
	});

	test("a pin is readable back and is per pane", () => {
		setPinnedAccount("pane-1", AMITAI);
		expect(getPinnedAccount("pane-1")).toEqual(AMITAI);
		expect(getPinnedAccount("pane-2")).toBeNull();
	});

	test("a pin survives the module's cache being cold", () => {
		setPinnedAccount("pane-1", AMITAI);
		// Same effect as a window reload: the Map is empty, the store is not.
		forgetPinnedAccountKeepingStorage(store, "pane-1");
		expect(getPinnedAccount("pane-1")).toEqual(AMITAI);
	});

	test("clearing returns the pane to the global account", () => {
		setPinnedAccount("pane-1", AMITAI);
		clearPinnedAccount("pane-1");
		expect(getPinnedAccount("pane-1")).toBeNull();
		expect(store.size).toBe(0);
	});

	test("subscribers are told when the pin changes", () => {
		let calls = 0;
		const unsubscribe = subscribePinnedAccount("pane-1", () => {
			calls++;
		});
		setPinnedAccount("pane-1", AMITAI);
		clearPinnedAccount("pane-1");
		unsubscribe();
		setPinnedAccount("pane-1", AMITAI);
		expect(calls).toBe(2);
	});

	test("a corrupt stored value is ignored, not thrown", () => {
		store.set("gatedspace:session-account:pane-2", "{not json");
		expect(getPinnedAccount("pane-2")).toBeNull();
	});
});

/** Forget the in-memory copy only, leaving what's on disk — a reload. */
function forgetPinnedAccountKeepingStorage(
	store: Map<string, string>,
	key: string,
): void {
	const saved = store.get(`gatedspace:session-account:${key}`);
	forgetPinnedAccount(key);
	if (saved) store.set(`gatedspace:session-account:${key}`, saved);
}
