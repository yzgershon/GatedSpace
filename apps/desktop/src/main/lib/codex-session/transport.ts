import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { version } from "../../../../package.json";
import { record, text } from "../../../shared/codex-session/types";
import { agentBrowserMcp } from "../browser/agent-browser-mcp";
import { resolveExecutable } from "../claude-session/resolve-executable";
import { resolveNativeCodex } from "./resolve-native";

export class CodexRpcError extends Error {
	constructor(
		message: string,
		readonly code: number,
	) {
		super(message);
	}
}

/** Skip our interactive shell wrappers; app-server requires clean JSONL stdio. */
export function resolveCodexExecutable() {
	const pathDirs = (process.env.PATH ?? "")
		.split(delimiter)
		.filter((dir) => !/[\\/]\.superset[\\/]bin[\\/]?$/i.test(dir));
	if (process.platform === "win32") {
		const native = pathDirs
			.map((dir) => join(dir, "codex.exe"))
			.find(existsSync);
		if (native) return { command: native, args: [] as string[], env: {} };
		for (const dir of pathDirs) {
			const script = join(
				dir,
				"node_modules",
				"@openai",
				"codex",
				"bin",
				"codex.js",
			);
			if (existsSync(script)) return resolveNativeCodex(script);
		}
	}
	const resolved = resolveExecutable("codex", { pathDirs });
	if (!resolved.needsShell)
		return { command: resolved.command, args: [] as string[], env: {} };
	// npm's .cmd shim cannot be spawned safely with arbitrary arguments. Run
	// its actual JS entry with Electron's Node mode, without a shell.
	const entry = join(
		dirname(resolved.command),
		"node_modules",
		"@openai",
		"codex",
		"bin",
		"codex.js",
	);
	if (existsSync(entry))
		return process.platform === "win32"
			? resolveNativeCodex(entry)
			: {
					command: process.execPath,
					args: [entry],
					env: { ELECTRON_RUN_AS_NODE: "1" },
				};
	throw new Error(
		"Install the Codex CLI or add codex.exe to PATH to use native Codex sessions.",
	);
}

export class CodexTransport extends EventEmitter {
	private child: ChildProcessWithoutNullStreams | null = null;
	private ready: Promise<void> | null = null;
	private sequence = 0;
	private generation = 0;
	private browserDispose?: () => void;
	private pending = new Map<
		number,
		{
			resolve: (v: unknown) => void;
			reject: (e: Error) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	constructor(private readonly executable = resolveCodexExecutable) {
		super();
	}

	start(): Promise<void> {
		if (this.ready) return this.ready;
		const generation = ++this.generation;
		this.ready = this.connect(generation).catch((error) => {
			if (generation === this.generation) this.dispose();
			throw error;
		});
		return this.ready;
	}
	private async connect(generation: number) {
		const executable = this.executable();
		const bridge = await agentBrowserMcp.connect("codex");
		if (generation !== this.generation) {
			bridge.dispose();
			throw new Error("Codex connection was cancelled.");
		}
		this.browserDispose = bridge.dispose;
		const child = spawn(
			executable.command,
			[
				...executable.args,
				"app-server",
				"-c",
				`mcp_servers.gatedspace_browser={url=${JSON.stringify(bridge.url)},bearer_token_env_var="GATEDSPACE_BROWSER_TOKEN"}`,
			],
			{
				stdio: "pipe",
				windowsHide: true,
				shell: false,
				env: {
					...process.env,
					...executable.env,
					GATEDSPACE_BROWSER_TOKEN: bridge.token,
				},
			},
		);
		this.child = child;
		const lines = createInterface({ input: child.stdout });
		lines.on("line", (line) => {
			let message: Record<string, unknown>;
			try {
				message = record(JSON.parse(line));
			} catch {
				return;
			}
			if (typeof message.method === "string") {
				this.emit(
					message.id !== undefined ? "request" : "notification",
					message,
				);
				return;
			}
			const waiter = this.pending.get(Number(message.id));
			if (!waiter) return;
			this.pending.delete(Number(message.id));
			clearTimeout(waiter.timer);
			if (message.error) {
				const error = record(message.error);
				waiter.reject(
					new CodexRpcError(text(error.message), Number(error.code)),
				);
			} else waiter.resolve(message.result);
		});
		// Drain diagnostics without logging prompts, credentials, or configuration.
		child.stderr.resume();
		const failed = (error: Error) => {
			if (this.child !== child) return;
			this.browserDispose?.();
			this.browserDispose = undefined;
			this.child = null;
			this.ready = null;
			lines.close();
			for (const waiter of this.pending.values()) {
				clearTimeout(waiter.timer);
				waiter.reject(error);
			}
			this.pending.clear();
			this.emit("disconnected", error);
		};
		child.once("error", failed);
		child.once("exit", (code) =>
			failed(
				new Error(
					`Codex connection closed (${code ?? "terminated"}). Reconnect to continue your saved conversation.`,
				),
			),
		);
		child.stdin.on("error", failed);
		await this.call("initialize", {
			clientInfo: {
				name: "gatedspace",
				title: "GatedSpace",
				version,
			},
			capabilities: { experimentalApi: true },
		});
		this.write({ method: "initialized", params: {} });
	}
	private write(message: unknown) {
		if (!this.child || this.child.stdin.destroyed)
			throw new Error("Codex is not connected.");
		this.child.stdin.write(`${JSON.stringify(message)}\n`);
	}
	private call(method: string, params: unknown): Promise<unknown> {
		const id = ++this.sequence;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Codex did not respond to ${method}.`));
			}, 60_000);
			this.pending.set(id, { resolve, reject, timer });
			try {
				this.write({ id, method, params });
			} catch (error) {
				clearTimeout(timer);
				this.pending.delete(id);
				reject(error);
			}
		});
	}
	async request(method: string, params: unknown = {}): Promise<unknown> {
		await this.start();
		return this.call(method, params);
	}
	respond(id: string | number, result: unknown) {
		this.write({ id, result });
	}
	reject(id: string | number, message: string) {
		this.write({ id, error: { code: -32601, message } });
	}
	dispose() {
		this.generation++;
		this.browserDispose?.();
		this.browserDispose = undefined;
		const child = this.child;
		this.child = null;
		this.ready = null;
		for (const waiter of this.pending.values()) {
			clearTimeout(waiter.timer);
			waiter.reject(new Error("Codex connection closed."));
		}
		this.pending.clear();
		child?.stdin.end();
		child?.kill();
	}
}
