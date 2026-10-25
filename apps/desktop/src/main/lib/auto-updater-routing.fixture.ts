// Run in a subprocess so Electron/main-module mocks cannot leak into other tests.
import { describe, expect, it, mock } from "bun:test";
import { EventEmitter } from "node:events";

const personal = process.env.GS_UPDATE_TEST_CHANNEL !== "public";
const quit = mock(() => {});
const skipConfirmation = mock(() => {});
const message = mock(async (_options: unknown) => ({ response: 1 }));
const publicCheck = mock(async () => ({ updateInfo: { version: "1.18.10" } }));
const publicInstall = mock(() => {});
const setFeedURL = mock((_options: unknown) => {});
const updater = Object.assign(new EventEmitter(), {
	checkForUpdates: publicCheck,
	quitAndInstall: publicInstall,
	setFeedURL,
});
let target: { version: string; installerPath: string } | null = {
	version: "1.18.10",
	installerPath: "C:/build/personal.exe",
};
let failInstall = false;
let finishInstall: (() => void) | undefined;
const launch = mock(async (_path: string, onQuit: () => void) => {
	if (failInstall) throw Error("Waiter failed to start");
	await new Promise<void>((resolve) => {
		finishInstall = resolve;
	});
	onQuit();
});
mock.module("electron", () => ({
	app: {
		getVersion: () => "1.18.9",
		quit,
		isReady: () => false,
		whenReady: () => new Promise(() => {}),
	},
	dialog: { showMessageBox: message },
}));
mock.module("electron-log/main", () => ({
	default: { info() {}, warn() {}, error() {}, transports: { file: {} } },
}));
mock.module("electron-updater", () => ({ autoUpdater: updater }));
mock.module("main/env.main", () => ({
	env: {
		NODE_ENV: "production",
		GATEDSPACE_PERSONAL: personal ? "1" : "",
		NEXT_PUBLIC_RELEASE_BUILD: personal ? "" : "1",
	},
}));
mock.module("main/index", () => ({
	setSkipQuitConfirmation: skipConfirmation,
}));
mock.module("main/lib/app-state", () => ({
	appState: { data: {}, write: async () => {} },
}));
mock.module("shared/constants", () => ({ PLATFORM: { IS_WINDOWS: true } }));
mock.module("./crash-sentinel", () => ({ crashSentinel: { expectExit() {} } }));
mock.module("./personal-update", () => ({
	findPersonalUpdate: () => target,
	readPersonalReleaseDir: () => "C:/build",
	installPersonalUpdate: launch,
}));
const api = await import("./auto-updater");

describe(`${personal ? "personal" : "public"} updater routing`, () => {
	it("checks the correct source through the shared update action", async () => {
		api.checkForUpdates();
		await Promise.resolve();
		if (personal) {
			expect(api.getUpdateStatus()).toMatchObject({
				status: "ready",
				version: "1.18.10",
			});
			expect(publicCheck).not.toHaveBeenCalled();
		} else {
			expect(publicCheck).toHaveBeenCalledTimes(1);
			expect(api.getPersonalUpdate()).toBeNull();
		}
	});
	if (!personal) {
		it("publishes download and ready events for public Windows installs without a personal config", async () => {
			api.setupAutoUpdater();
			expect(setFeedURL).toHaveBeenCalledWith({
				provider: "generic",
				url: "https://github.com/yzgershon/GatedSpace/releases/latest/download",
			});
			const events: unknown[] = [];
			const onStatus = (event: unknown) => events.push(event);
			api.autoUpdateEmitter.on("status-changed", onStatus);
			try {
				updater.emit("update-available", { version: "1.18.10" });
				updater.emit("download-progress", {
					percent: 42,
					transferred: 42,
					total: 100,
				});
				expect(api.getUpdateStatus()).toMatchObject({
					status: "downloading",
					version: "1.18.10",
					progress: { percent: 42 },
				});
				await api.installUpdate();
				expect(publicInstall).not.toHaveBeenCalled();
				updater.emit("update-downloaded", { version: "1.18.10" });
				expect(api.getUpdateStatus()).toMatchObject({
					status: "ready",
					version: "1.18.10",
				});
				expect(events).toHaveLength(3);
				await api.installUpdate();
				await api.installUpdate();
				expect(publicInstall).toHaveBeenCalledTimes(1);
				expect(publicInstall).toHaveBeenCalledWith(false, true);
				expect(skipConfirmation).toHaveBeenCalledTimes(1);
				expect(launch).not.toHaveBeenCalled();
				updater.emit("error", new Error("Installer failed to start"));
				expect(api.getUpdateStatus()).toMatchObject({
					status: "error",
					error: "Installer failed to start",
				});
				api.checkForUpdates();
				expect(publicCheck).toHaveBeenCalledTimes(2);
				updater.emit("update-not-available", { version: "1.18.9" });
				expect(api.getUpdateStatus().status).toBe("idle");
			} finally {
				api.autoUpdateEmitter.off("status-changed", onStatus);
			}
		});
		return;
	}
	it("manual check finds the personal installer without calling the public feed", async () => {
		api.checkForUpdatesInteractive();
		await new Promise((done) => setTimeout(done, 0));
		expect(message.mock.calls.at(-1)?.[0]).toMatchObject({
			title: "Personal update available",
		});
		expect(publicCheck).not.toHaveBeenCalled();
	});
	it("rejects a stale target, surfaces launch failures and permits retry", async () => {
		await expect(
			api.installAvailablePersonalUpdate("C:/wrong.exe"),
		).rejects.toThrow("No completed personal update");
		expect(launch).not.toHaveBeenCalled();
		failInstall = true;
		await expect(api.installUpdate()).rejects.toThrow("Waiter failed to start");
		expect(api.getUpdateStatus()).toMatchObject({
			status: "error",
			error: "Waiter failed to start",
		});
		expect(quit).not.toHaveBeenCalled();
		failInstall = false;
	});
	it("awaits startup acknowledgement, suppresses duplicate clicks, and bypasses the extra quit dialog", async () => {
		const pending = api.installUpdate();
		expect(quit).not.toHaveBeenCalled();
		await api.installUpdate();
		expect(launch).toHaveBeenCalledTimes(2); // One failure, one successful attempt.
		finishInstall?.();
		await pending;
		expect(quit).toHaveBeenCalledTimes(1);
		expect(skipConfirmation).toHaveBeenCalledTimes(1);
		expect(publicInstall).not.toHaveBeenCalled();
		target = null;
	});
});
