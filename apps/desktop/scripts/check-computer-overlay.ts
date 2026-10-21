/** Isolated Electron overlay check. Uses a fake controller, never desktop input. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { initTRPC } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { app, BrowserWindow, screen } from "electron";
import superjson from "superjson";
import { createIPCHandler } from "trpc-electron/main";
import {
	ComputerUseOverlay,
	computerOverlayBounds,
} from "../src/main/lib/computer-use/overlay";
import { ComputerUseService } from "../src/main/lib/computer-use/service";
import type { ComputerUseState } from "../src/shared/computer-use";

const output = resolve(process.cwd(), ".tmp/computer-overlay-test");
const rendererErrors: string[] = [];
const bundle = process.env.OVERLAY_BUNDLE ?? resolve(output, "fixture");
app.setPath("userData", resolve(output, "profile"));
let finishAction: (() => void) | undefined;
const service = new ComputerUseService(() => ({
	start: async () => [{ name: "Type", inputSchema: { type: "object" } }],
	call: async () => {
		await new Promise<void>((resolve) => {
			finishAction = resolve;
		});
		return { content: [] };
	},
	close: async () => {
		finishAction?.();
	},
}));
const t = initTRPC.create({ transformer: superjson });
const router = t.router({
	codexSession: t.router({
		computerStop: t.procedure.mutation(async () => {
			await service.stop();
			return service.get();
		}),
		computerStream: t.procedure.subscription(() =>
			observable<ComputerUseState>((emit) => {
				const listener = (state: ComputerUseState) => emit.next(state);
				service.on("change", listener);
				emit.next(service.get());
				return () => {
					service.off("change", listener);
				};
			}),
		),
	}),
});
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => Promise<boolean> | boolean, message: string) {
	const end = Date.now() + 15_000;
	while (Date.now() < end) {
		if (await check()) return;
		await delay(50);
	}
	throw new Error(message);
}
void (async () => {
	await mkdir(output, { recursive: true });
	await app.whenReady();
	app.on("window-all-closed", () => {});
	const errors = rendererErrors;
	const handler = createIPCHandler({ router });
	const overlay = new ComputerUseOverlay(
		(window) => {
			handler.attachWindow(window);
			window.webContents.on("console-message", (_event, level, message) => {
				if (level >= 3) errors.push(message);
			});
			window.webContents.on("preload-error", (_event, _path, error) =>
				errors.push(error.message),
			);
		},
		service,
		{
			preload: resolve(bundle, "preload/computer-overlay.js"),
			html: resolve(bundle, "renderer/computer-overlay.html"),
			devUrl: undefined,
		},
	);
	const toolbar = () =>
		BrowserWindow.getAllWindows().find(
			(w) => w.getTitle() === "GatedSpace computer control",
		);
	const status = async () =>
		toolbar()?.webContents.executeJavaScript(
			"document.getElementById('control-status').textContent",
		);
	assert.equal(BrowserWindow.getAllWindows().length, 0);
	await service.enable("codex:overlay-test");
	await until(
		async () =>
			toolbar()?.isVisible() === true &&
			(await status()) === "Computer control ready",
		"Toolbar did not become ready",
	);
	let bar = toolbar();
	assert.ok(bar);
	const borders = BrowserWindow.getAllWindows().filter((w) => w !== bar);
	assert.equal(borders.length, screen.getAllDisplays().length);
	for (const window of [...borders, bar]) {
		assert.equal(window.isFocused(), false);
		assert.equal(window.isAlwaysOnTop(), true);
		assert.equal(window.isFocusable(), false);
	}
	for (const display of screen.getAllDisplays())
		await until(
			() =>
				borders.some(
					(w) =>
						JSON.stringify(w.getBounds()) === JSON.stringify(display.bounds),
				),
			`Border bounds ${JSON.stringify(borders.map((w) => w.getBounds()))} did not match display ${JSON.stringify(display.bounds)}`,
		);
	assert.deepEqual(
		computerOverlayBounds({
			workArea: { x: -1920, y: 0, width: 1920, height: 1040 },
		}),
		{ x: -1160, y: 12, width: 400, height: 52 },
	);
	const layout = await bar.webContents.executeJavaScript(
		"({width:innerWidth, overflow:document.documentElement.scrollWidth > innerWidth, transparent:getComputedStyle(document.body).backgroundColor})",
	);
	assert.equal(layout.overflow, false);
	assert.equal(layout.transparent, "rgba(0, 0, 0, 0)");
	for (const border of borders) {
		const glow = await border.webContents.executeJavaScript(
			"(() => {const s=getComputedStyle(document.getElementById('control-border'));return {border:s.borderTopWidth,shadow:s.boxShadow,inset:s.top}})()",
		);
		assert.equal(glow.border, "0px");
		assert.notEqual(glow.shadow, "none");
		assert.equal(glow.inset, "0px");
	}
	await writeFile(
		resolve(output, "ready.png"),
		(await bar.webContents.capturePage()).toPNG(),
	);
	const action = service.call("codex:overlay-test", "Type", {});
	await until(
		async () => (await status()) === "Typing",
		"Activity did not reach toolbar",
	);
	await writeFile(
		resolve(output, "typing.png"),
		(await bar.webContents.capturePage()).toPNG(),
	);
	finishAction?.();
	await action;
	await until(
		async () => (await status()) === "Computer control ready",
		"Idle state not restored",
	);
	bar.setBounds({ x: -10000, y: -10000, width: 400, height: 52 });
	screen.emit("display-metrics-changed");
	assert.ok(bar.getBounds().x > -10000);
	await bar.webContents.executeJavaScript(
		"document.getElementById('control-stop').click()",
	);
	await until(() => service.get().phase === "off", "Stop did not revoke grant");
	assert.equal(BrowserWindow.getAllWindows().length, 0);
	// Destroy an overlay while its document is loading. Its late load rejection
	// must not revoke the approval retained by idle pause or a later connection.
	await service.enable("codex:overlay-test");
	await service.pause("codex:overlay-test");
	await delay(250);
	assert.equal(service.get().phase, "paused");
	assert.equal(BrowserWindow.getAllWindows().length, 0);
	assert.equal((await service.discover("codex:overlay-test"))[0].name, "Type");
	await service.enable("codex:overlay-test");
	await until(
		async () =>
			toolbar()?.isVisible() === true &&
			(await status()) === "Computer control ready",
		"Re-enable failed",
	);
	bar = toolbar();
	assert.ok(bar);
	bar.destroy();
	await until(
		() => service.get().phase === "error",
		"Unexpected overlay close must revoke control",
	);
	assert.equal(BrowserWindow.getAllWindows().length, 0);
	assert.deepEqual(errors, []);
	const result = {
		ok: true,
		bundle,
		controller: "simulated",
		checks: [
			"off creates no windows",
			"one border per display",
			"always on top without focus",
			"DPI and negative-origin geometry",
			"transparent and fits",
			"soft full-screen glow with no hard border",
			"pause closes indicators without losing approval",
			"stale overlay load failures do not revoke a later grant",
			"live action and idle labels",
			"display-change recovery",
			"Stop over tRPC",
			"unexpected-close revokes access",
			"no renderer errors",
		],
	};
	await writeFile(
		resolve(output, "results.json"),
		JSON.stringify(result, null, 2),
	);
	console.log(JSON.stringify(result));
	if (process.argv.includes("--preview")) {
		await service.enable("codex:overlay-test");
		await until(
			async () =>
				toolbar()?.isVisible() === true &&
				(await status()) === "Computer control ready",
			"Preview failed",
		);
		await toolbar()?.webContents.executeJavaScript(
			"document.querySelector('.control-brand').textContent='CODEX · OVERLAY PREVIEW'",
		);
		service.on("change", (state) => {
			if (state.phase === "off") {
				overlay.dispose();
				app.exit(0);
			}
		});
		return;
	}
	overlay.dispose();
	app.exit(0);
})().catch((error) => {
	console.error(error);
	console.error(JSON.stringify({ rendererErrors }));
	app.exit(1);
});
