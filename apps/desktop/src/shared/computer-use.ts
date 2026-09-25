export interface ComputerUseState {
	phase: "off" | "connecting" | "ready" | "stopping" | "error";
	owner?: string;
	activity?: string;
	error?: string;
}

export const COMPUTER_STOP_SHORTCUT = "Control+Alt+Shift+Escape";
export const COMPUTER_STOP_LABEL = "Ctrl + Alt + Shift + Esc";
