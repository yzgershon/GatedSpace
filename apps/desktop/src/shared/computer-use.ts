export interface ComputerUseState {
	phase: "off" | "connecting" | "ready" | "paused" | "stopping" | "error";
	owner?: string;
	activity?: string;
	error?: string;
	request?: { owner: string; reason: string };
}

export const COMPUTER_IDLE_TIMEOUT_MS = 60_000;

export const COMPUTER_STOP_SHORTCUT = "Control+Alt+Shift+Escape";
export const COMPUTER_STOP_LABEL = "Ctrl + Alt + Shift + Esc";
