import { FirstTerminalCommand } from "shared/terminal-naming";
import { electronTrpcClient } from "../trpc-client";

const commands = new Map<string, FirstTerminalCommand>();
export async function registerTerminalName(
	id: string,
	command?: string,
	prompt?: string,
	captureInput = true,
) {
	try {
		await electronTrpcClient.sessionNames.terminalStarted.mutate({
			id,
			command,
			prompt,
		});
		if (captureInput && !command?.trim() && !prompt?.trim())
			commands.set(id, new FirstTerminalCommand());
	} catch (error) {
		console.warn("[session-names] terminal registration failed", error);
	}
}
export function observeFirstTerminalCommand(
	id: string | undefined,
	data: string,
) {
	if (!id) return;
	const collector = commands.get(id);
	if (!collector) return;
	const prompt = collector.take(data);
	if (collector.finished) commands.delete(id);
	if (prompt)
		void electronTrpcClient.sessionNames.terminalPrompt
			.mutate({ id, prompt })
			.catch((error) =>
				console.warn("[session-names] terminal naming failed", error),
			);
}
