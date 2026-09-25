import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
	type CallToolResult,
	CallToolResultSchema,
	type Tool,
} from "@modelcontextprotocol/sdk/types.js";

// Keep the integration scoped to UI operations. Shell, registry, process and
// filesystem tools already have their own permission paths in Codex.
export const COMPUTER_TOOLS = new Set([
	"Screenshot",
	"Snapshot",
	"App",
	"Click",
	"Type",
	"Scroll",
	"Move",
	"Drag",
	"Shortcut",
	"Wait",
]);
export const WINDOWS_MCP_VERSION = "0.8.5";

export interface ComputerBackend {
	start(signal: AbortSignal): Promise<Tool[]>;
	call(
		name: string,
		args: Record<string, unknown>,
		signal: AbortSignal,
	): Promise<CallToolResult>;
	close(): Promise<void>;
	onDisconnect?: () => void;
}

export function resolveComputerRunner() {
	if (process.platform !== "win32")
		throw new Error("Computer control is currently available on Windows.");
	const dirs = [
		(process.env.PATH ?? "").split(delimiter),
		[join(homedir(), ".local", "bin")],
	].flat();
	const command = dirs
		.filter(Boolean)
		.map((dir) => join(dir, "uvx.exe"))
		.find(existsSync);
	if (!command)
		throw new Error(
			"Install uv from astral.sh/uv, then reopen GatedSpace to enable computer control.",
		);
	return command;
}

export class WindowsComputerBackend implements ComputerBackend {
	private client = new Client({
		name: "gatedspace-computer",
		version: "1.0.0",
	});
	private transport?: StdioClientTransport;
	private closing?: Promise<void>;
	onDisconnect?: () => void;
	get processId() {
		return this.transport?.pid ?? null;
	}
	async start(signal: AbortSignal) {
		if (signal.aborted) throw new Error("Computer connection cancelled.");
		this.transport = new StdioClientTransport({
			command: resolveComputerRunner(),
			args: [
				"--from",
				`windows-mcp==${WINDOWS_MCP_VERSION}`,
				"windows-mcp",
				"serve",
				"--transport",
				"stdio",
				"--tools",
				[...COMPUTER_TOOLS].join(","),
			],
			stderr: "pipe",
			env: {
				ANONYMIZED_TELEMETRY: "false",
				POSTHOG_API_KEY: "",
				WINDOWS_MCP_WATCHDOG: "false",
				WINDOWS_MCP_SCREENSHOT_BACKEND: "pillow",
				PYTHONIOENCODING: "utf-8",
				UV_NO_PROGRESS: "1",
			},
		});
		// Never log screenshot contents, typed text, or subprocess diagnostics.
		this.transport.stderr?.on("data", () => {});
		this.client.onclose = () => {
			if (!this.closing) this.onDisconnect?.();
		};
		await this.client.connect(this.transport, { timeout: 180_000, signal });
		const result = await this.client.listTools({}, { timeout: 15_000, signal });
		const tools = result.tools.filter((tool) => COMPUTER_TOOLS.has(tool.name));
		if (
			!tools.some((tool) => tool.name === "Snapshot") ||
			!tools.some((tool) => tool.name === "Click")
		)
			throw new Error(
				"The Windows controller did not provide the required desktop tools.",
			);
		return tools;
	}
	async call(name: string, args: Record<string, unknown>, signal: AbortSignal) {
		return CallToolResultSchema.parse(
			await this.client.callTool(
				{ name, arguments: args },
				CallToolResultSchema,
				{ timeout: 45_000, signal },
			),
		);
	}
	close() {
		if (this.closing) return this.closing;
		this.closing = (async () => {
			// uvx has a Python child. Kill the owned process tree, not just the
			// launcher: an in-flight click must not outlive the Stop button.
			const pid = this.transport?.pid;
			if (pid && process.platform === "win32") {
				await new Promise<void>((resolve) => {
					execFile(
						join(
							process.env.SystemRoot || "C:\\Windows",
							"System32",
							"taskkill.exe",
						),
						["/PID", String(pid), "/T", "/F"],
						{ windowsHide: true, timeout: 5_000 },
						() => resolve(),
					);
				});
			}
			await this.client.close().catch(() => {});
			await this.transport?.close().catch(() => {});
		})();
		return this.closing;
	}
}
