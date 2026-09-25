/** Real Electron lifecycle + native MCP handshake; never calls desktop UI tools. */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { app, globalShortcut, powerMonitor } from "electron";
import {
	enableComputerUse,
	installComputerUseLifecycle,
} from "../src/main/lib/computer-use/lifecycle";
import { computerUseService } from "../src/main/lib/computer-use/service";
import { COMPUTER_STOP_SHORTCUT } from "../src/shared/computer-use";

const output = resolve(process.cwd(), ".tmp/computer-native");
app.setPath("userData", resolve(output, "profile"));
const check = (condition: boolean, message: string) => {
	if (!condition) throw new Error(message);
};
void (async () => {
	await mkdir(output, { recursive: true });
	await app.whenReady();
	installComputerUseLifecycle();
	try {
		check(computerUseService.get().phase === "off", "Must start disabled");
		const state = await enableComputerUse("native-test");
		check(
			state.phase === "ready",
			state.error ?? "Native controller did not connect",
		);
		check(
			globalShortcut.isRegistered(COMPUTER_STOP_SHORTCUT),
			"Emergency stop not registered",
		);
		check(
			computerUseService
				.discover("codex:native-test")
				.some((t) => t.name === "Snapshot"),
			"Missing Snapshot",
		);
		powerMonitor.emit("lock-screen");
		await computerUseService.stop();
		check(computerUseService.get().phase === "off", "Lock must revoke control");
		await enableComputerUse("native-test");
		powerMonitor.emit("suspend");
		await computerUseService.stop();
		check(
			computerUseService.get().phase === "off",
			"Suspend must revoke control",
		);
		const result = {
			ok: true,
			desktopActions: 0,
			checks: [
				"disabled on startup",
				"real Electron controller connection",
				"emergency shortcut registered",
				"tool discovery",
				"lock-screen revocation",
				"suspend revocation",
			],
		};
		await writeFile(
			resolve(output, "results.json"),
			JSON.stringify(result, null, 2),
		);
		console.log(JSON.stringify(result));
	} finally {
		await computerUseService.stop();
		globalShortcut.unregister(COMPUTER_STOP_SHORTCUT);
	}
	app.exit(0);
})().catch((error) => {
	console.error(error);
	app.exit(1);
});
