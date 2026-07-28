import { HistoryIcon, TerminalIcon } from "lucide-react";
import {
	getCommandHistorySnapshot,
	refreshCommandHistory,
} from "renderer/lib/command-history-snapshot";
import { useRunCommandIntent } from "renderer/stores/run-command-intent";
import type { Command, CommandProvider } from "../../core/types";

/**
 * Shell history in the palette.
 *
 * The rows come from the pty-daemon's JSONL, ranked by frecency — repetition
 * counted in distinct days rather than raw runs, so one afternoon of debugging
 * does not outrank a fortnight of routine. Failures are kept but ranked below
 * equivalent successes: re-running something that just failed is one of the
 * commonest reasons to open history at all.
 *
 * Selecting one does NOT execute it. It writes the command into the focused
 * terminal and leaves the cursor there, so a half-remembered command can be
 * corrected before it runs. Executing straight from a fuzzy-matched list is how
 * people run the wrong `rm` at the wrong path.
 */
const MAX_HISTORY_ITEMS = 12;

function truncate(command: string, max = 72): string {
	return command.length <= max ? command : `${command.slice(0, max - 1)}…`;
}

function historyChildren(): Command[] {
	return getCommandHistorySnapshot()
		.slice(0, MAX_HISTORY_ITEMS)
		.map((entry, index) => ({
			// Rank rather than command text: the id must be stable within one
			// render, and a command can legitimately contain anything.
			id: `history.run.${index}`,
			title: truncate(entry.command),
			section: "actions" as const,
			icon: TerminalIcon,
			keywords: [entry.command, entry.lastSucceeded ? "" : "failed"].filter(
				Boolean,
			),
			run: () => {
				useRunCommandIntent.getState().request(entry.command);
			},
		}));
}

export const historyProvider: CommandProvider = {
	id: "history",
	provide: () => {
		// Fire-and-forget: the palette renders from the previous snapshot, and a
		// changed result re-registers this provider, which re-renders the list.
		//
		// No cwd bias yet — CommandContext carries the workspace but not the
		// focused terminal's directory, and guessing it from the workspace root
		// would boost the wrong commands in any repo with subprojects.
		void refreshCommandHistory();

		if (getCommandHistorySnapshot().length === 0) return [];

		return [
			{
				id: "history.recentCommands",
				title: "Run a recent command",
				section: "actions",
				icon: HistoryIcon,
				keywords: ["shell", "terminal", "history", "rerun", "command"],
				children: historyChildren,
			},
		];
	},
};
