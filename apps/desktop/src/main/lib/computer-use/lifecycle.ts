import { app, globalShortcut, powerMonitor } from "electron";
import { COMPUTER_STOP_SHORTCUT } from "../../../shared/computer-use";
import { computerUseService } from "./service";

let shortcutReady = false;
export function installComputerUseLifecycle() {
	const stop = () => {
		void computerUseService.stop();
	};
	powerMonitor.on("suspend", stop);
	powerMonitor.on("lock-screen", stop);
	app.on("before-quit", stop);
}

export function enableComputerUse(key: string) {
	if (!shortcutReady) {
		shortcutReady = globalShortcut.register(COMPUTER_STOP_SHORTCUT, () => {
			void computerUseService.stop();
		});
		if (!shortcutReady)
			throw new Error(
				"The emergency stop shortcut is already in use. Free Ctrl+Alt+Shift+Esc before enabling computer control.",
			);
	}
	return computerUseService.enable(`codex:${key}`);
}
