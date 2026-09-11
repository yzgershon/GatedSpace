import type { ExecutionMode } from "@superset/local-db/schema/zod";
import { buildTerminalCommand } from "renderer/lib/terminal/launch-command";
import { quote } from "shell-quote";

/**
 * Where a preset lands.
 *
 * `active-pane` is a STRONGER request than `active-tab`, and the difference is
 * the point. `active-tab` is a preference that the preset's own
 * `executionMode` is allowed to overrule — a preset configured "each in its own
 * new tab" still gets one. `active-pane` is the user pointing at a specific
 * pane and asking for the thing to appear THERE, which no mode may override.
 *
 * The launcher pane needs the second one. It is opened by the pane header's
 * `+`, which has already split the layout to make room; sending its choice to a
 * new tab undoes the split that was the whole reason for the gesture.
 */
export type PresetOpenTarget = "new-tab" | "active-tab" | "active-pane";
export type PresetMode = ExecutionMode;

export type PresetLaunchPlan =
	| "active-terminal"
	| "new-tab-single"
	| "new-tab-multi-pane"
	| "new-tab-per-command"
	| "active-tab-single"
	| "active-tab-multi-pane";

export function getPresetLaunchPlan({
	mode,
	target,
	commandCount,
	hasActiveTab,
	hasActiveTerminal,
}: {
	mode: PresetMode;
	target: PresetOpenTarget;
	commandCount: number;
	hasActiveTab: boolean;
	hasActiveTerminal?: boolean;
}): PresetLaunchPlan {
	const hasMultipleCommands = commandCount > 1;
	const wantsActiveTab = target === "active-tab" || target === "active-pane";
	const shouldUseActiveTab =
		wantsActiveTab &&
		hasActiveTab &&
		// An explicit `active-pane` wins over the preset's own mode; a plain
		// `active-tab` only applies to the modes that were already pane-shaped.
		(target === "active-pane" ||
			mode === "split-pane" ||
			mode === "sequential");

	if (mode === "sequential") {
		// Sequential grouped presets should never create split panes. Prefer the
		// focused terminal, then fall back to one new terminal tab.
		if (wantsActiveTab && hasActiveTerminal) {
			return "active-terminal";
		}
		return "new-tab-single";
	}

	if (shouldUseActiveTab) {
		return hasMultipleCommands ? "active-tab-multi-pane" : "active-tab-single";
	}

	if (mode === "new-tab" && hasMultipleCommands) {
		return "new-tab-per-command";
	}

	return hasMultipleCommands ? "new-tab-multi-pane" : "new-tab-single";
}

export function buildFocusedTerminalCommand({
	commands,
	cwd,
}: {
	commands: string[] | null | undefined;
	cwd?: string | null;
}): string | null {
	const runnableCommands = commands?.filter((command) => command.trim());
	const command = buildTerminalCommand(runnableCommands);
	if (command === null) return null;

	const trimmedCwd = cwd?.trim();
	// Existing terminals cannot receive a session cwd, so preserve preset
	// directory behavior by prepending an explicit cd before the commands.
	if (!trimmedCwd) return command;

	return `cd ${quote([trimmedCwd])} && ${command}`;
}

export function shouldApplyPresetPaneName({
	currentName,
	presetName,
	userTitle,
}: {
	currentName?: string | null;
	presetName?: string | null;
	userTitle?: string | null;
}): boolean {
	const trimmedName = presetName?.trim();
	if (!trimmedName) return false;

	if (userTitle?.trim()) return false;

	const currentTitle = currentName?.trim() ?? "";
	// Presets that reuse an existing terminal should only replace the default
	// label. Once any real label is present, later preset runs leave it alone.
	return currentTitle === "" || currentTitle === "Terminal";
}
