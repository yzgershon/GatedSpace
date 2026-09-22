/**
 * Main-process transport for a Claude Code session.
 *
 * Spawns the real `claude` binary in persistent streaming mode
 * (`--print --input-format stream-json --output-format stream-json
 * --include-partial-messages --verbose`), so the session runs on the user's
 * subscription with all of Claude Code's config (CLAUDE.md, skills, subagents,
 * MCP, hooks) intact — only the rendering surface changes. See
 * apps/desktop/plans/20260724-claude-code-session-ui.md.
 *
 * Responsibilities: spawn + account binding (CLAUDE_CONFIG_DIR), stdout→typed
 * events via NdjsonLineBuffer + parseStreamLine, stderr kept separate for
 * diagnostics, user-message input over stdin, interrupt, and teardown. IPC to
 * the renderer is wired in a later increment; this module is transport only.
 */
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type ClaudeStreamEvent,
	parseStreamLine,
	type UserImagePayload,
} from "shared/claude-session/events";
import { sanitizePresetArgs } from "shared/claude-session/preset-args";
import { agentBrowserMcp } from "../browser/agent-browser-mcp";
import {
	agentBrowserService,
	browserInstructions,
} from "../browser/agent-browser-service";
import { getClaudeProfile } from "../claude-profile";
import { ensureSecureDir, writeSecureFile } from "../secure-file";
import { withFastSettings } from "./fast-settings";
import { NdjsonLineBuffer } from "./ndjson-line-buffer";
import { PermissionRequests } from "./permission-requests";
import { resolveNativeClaude } from "./resolve-native";

export interface ClaudeSessionOptions {
	workspaceId?: string;
	sessionKey?: string;
	fast?: boolean;
	/** Working directory for the session (the workspace/worktree path). */
	cwd: string;
	/** Model id, e.g. "claude-opus-4-8". Omit to use the CLI default. */
	model?: string;
	/**
	 * Permission mode → maps to the UI's Manual / Edit automatically / Plan /
	 * Auto. Passed as `--permission-mode`. Omit for the CLI default.
	 */
	permissionMode?: "manual" | "acceptEdits" | "plan" | "bypassPermissions";
	/** Resume an existing session id instead of starting fresh. */
	resumeSessionId?: string;
	/**
	 * Resume into a COPY under a fresh session id (`--fork-session`). Used when
	 * the original is already open somewhere: both keep writing, but to
	 * different transcripts, so neither destroys the other.
	 */
	forkSession?: boolean;
	/**
	 * Explicit account config dir (CLAUDE_CONFIG_DIR). Defaults to the active
	 * profile from the switcher, so a session binds to whatever account is
	 * selected at spawn time — matching how terminals behave today.
	 */
	configDir?: string;
	/** Path/name of the claude binary. Defaults to "claude" on PATH. */
	binary?: string;
	/**
	 * Extra launch args from the user's configured Claude agent preset. Passed
	 * through `sanitizePresetArgs`, so a preset can add MCP configs or extra
	 * directories without being able to break the stream-json protocol or
	 * contradict the composer's mode.
	 */
	extraArgs?: string[];
	/** Extra environment from the agent preset, merged over the inherited env. */
	env?: Record<string, string>;
}

export type ClaudeSessionEvents = {
	/** A parsed protocol event from stdout. */
	event: [ClaudeStreamEvent];
	/** A raw stderr line (diagnostics only — never protocol). */
	stderr: [string];
	/** A line from stdout that failed to parse as JSON (should be rare). */
	parseError: [string];
	/** Process exited. */
	exit: [{ code: number | null; signal: NodeJS.Signals | null }];
	/** Spawn or runtime error. */
	error: [Error];
};

/** Resolve the config dir for the account currently selected in the switcher. */
export function resolveActiveConfigDir(): string | undefined {
	const { activeProfileId, profiles } = getClaudeProfile();
	return profiles.find((p) => p.id === activeProfileId)?.configDir;
}

export class ClaudeSessionTransport extends EventEmitter {
	private child: ChildProcessWithoutNullStreams | null = null;
	private readonly stdoutBuffer = new NdjsonLineBuffer();
	private readonly stderrBuffer = new NdjsonLineBuffer();
	private started = false;
	private disposed = false;
	private queued: string[] = [];
	private browserDispose?: () => void;
	private browserConfig?: string;
	private permissions = new PermissionRequests(
		(value) => this.writeStdin(value),
		(event) => this.emit("event", event),
	);

	constructor(private readonly options: ClaudeSessionOptions) {
		super();
	}

	private buildArgs(): string[] {
		const args = [
			"--print",
			"--input-format",
			"stream-json",
			"--output-format",
			"stream-json",
			"--include-partial-messages",
			"--verbose",
			"--permission-prompt-tool",
			"stdio",
		];
		if (this.options.model) args.push("--model", this.options.model);
		if (this.options.permissionMode)
			args.push(
				"--permission-mode",
				this.options.permissionMode === "manual"
					? "default"
					: this.options.permissionMode,
			);
		if (this.options.resumeSessionId) {
			args.push("--resume", this.options.resumeSessionId);
			if (this.options.forkSession) args.push("--fork-session");
		}
		if (this.options.extraArgs?.length) {
			args.push(
				...sanitizePresetArgs(this.options.extraArgs, {
					hasModel: Boolean(this.options.model),
				}),
			);
		}
		// Explicit per-process setting enables /fast in headless mode without changing user defaults.
		return withFastSettings(args, this.options.cwd, this.options.fast ?? false);
	}

	private buildEnv(): NodeJS.ProcessEnv {
		const configDir = this.options.configDir ?? resolveActiveConfigDir();
		return {
			...process.env,
			...this.options.env,
			// The account binding wins over preset env — the switcher is the
			// source of truth for which account a session runs on.
			...(configDir ? { CLAUDE_CONFIG_DIR: configDir } : {}),
		};
	}

	/** Spawn the process and begin streaming events. Idempotent. */
	start(): void {
		if (this.started || this.disposed) return;
		this.started = true;
		void this.spawnSession().catch((error: Error) => {
			this.cleanupBrowser();
			if (!this.disposed) this.emit("error", error);
		});
	}
	private async spawnSession() {
		const args = this.buildArgs();
		if (this.options.workspaceId && this.options.sessionKey) {
			const key = `claude:${this.options.sessionKey}`;
			agentBrowserService.register(key, this.options.workspaceId);
			this.browserDispose = () => agentBrowserService.unregister(key);
			const bridge = await agentBrowserMcp.connect(key);
			if (this.disposed) {
				bridge.dispose();
				return;
			}
			this.browserDispose = () => {
				bridge.dispose();
				agentBrowserService.unregister(key);
			};
			const directory = join(tmpdir(), `gatedspace-browser-${process.pid}`);
			ensureSecureDir(directory);
			this.browserConfig = join(directory, `${randomUUID()}.json`);
			writeSecureFile(
				this.browserConfig,
				JSON.stringify({
					mcpServers: {
						gatedspace_browser: {
							type: "http",
							url: bridge.url,
							headers: { Authorization: `Bearer ${bridge.token}` },
						},
					},
				}),
			);
			args.push(
				"--mcp-config",
				this.browserConfig,
				"--append-system-prompt",
				browserInstructions(key),
			);
		}

		// Resolve PATH ourselves so a real claude.exe spawns with NO shell. That
		// matters now that agent presets feed user-configured args into argv: a
		// shell would interpret `&&` and friends inside an argument instead of
		// passing them through. Npm shims resolve to their Node entry point.
		const executable = resolveNativeClaude(this.options.binary ?? "claude");
		this.child = spawn(executable.command, [...executable.args, ...args], {
			cwd: this.options.cwd,
			env: { ...this.buildEnv(), ...executable.env },
			shell: false,
			windowsHide: true,
		}) as ChildProcessWithoutNullStreams;

		this.child.stdout.setEncoding("utf-8");
		this.child.stderr.setEncoding("utf-8");

		this.child.stdout.on("data", (chunk: string) => {
			for (const line of this.stdoutBuffer.push(chunk))
				this.handleStdoutLine(line);
		});
		this.child.stderr.on("data", (chunk: string) => {
			for (const line of this.stderrBuffer.push(chunk)) {
				if (line.trim()) this.emit("stderr", line);
			}
		});
		this.child.on("error", (err) => this.emit("error", err));
		this.child.on("exit", (code, signal) => {
			this.cleanupBrowser();
			for (const line of this.stdoutBuffer.flush()) this.handleStdoutLine(line);
			this.permissions.clear();
			this.emit("exit", { code, signal });
		});
		for (const line of this.queued.splice(0)) this.child.stdin.write(line);
		this.child.stdin.on("error", (error: Error) => {
			if (!this.disposed) this.emit("error", error);
		});
	}
	private cleanupBrowser() {
		this.browserDispose?.();
		this.browserDispose = undefined;
		if (this.browserConfig) {
			try {
				unlinkSync(this.browserConfig);
			} catch {}
			this.browserConfig = undefined;
		}
	}

	private handleStdoutLine(line: string): void {
		if (!line.trim()) return;
		const event = parseStreamLine(line);
		if (this.permissions.handle(event)) return;
		if (event?.type === "result") this.permissions.clear();
		if (event) this.emit("event", event);
		else this.emit("parseError", line);
	}

	/** Send a user message into the running session (stream-json input). */
	/**
	 * Write a user turn to stdin.
	 *
	 * Images go BEFORE the text, which is the ordering the model reads best when
	 * the text is a question about the image. Verified against CLI 2.1.218: a
	 * base64 image block in a stream-json user message is genuinely seen, not
	 * just accepted (probe sent a solid red PNG and got "Red" back).
	 */
	sendUserMessage(text: string, images: UserImagePayload[] = []): void {
		const content: unknown[] = images.map((image) => ({
			type: "image",
			source: {
				type: "base64",
				media_type: image.mediaType,
				data: image.data,
			},
		}));
		// An image-only prompt is legitimate ("look at this"), so the text block is
		// only added when there is text — an empty one would be a wasted block.
		if (text) content.push({ type: "text", text });
		if (content.length === 0) return;
		this.writeStdin({
			type: "user",
			message: { role: "user", content },
		});
	}

	/**
	 * Request the model stop the current turn. The CLI advertises
	 * `interrupt_receipt_v1`; we send a control interrupt over stdin. Callers
	 * should treat this as best-effort and fall back to stop() if the process
	 * does not settle.
	 */
	interrupt(): void {
		this.permissions.clear();
		this.writeStdin({
			type: "control_request",
			request_id: randomUUID(),
			request: { subtype: "interrupt" },
		});
	}

	answerPermission(id: string, allow: boolean) {
		this.permissions.answer(id, allow);
	}

	private writeStdin(payload: unknown): void {
		if (this.disposed) return;
		const line = `${JSON.stringify(payload)}\n`;
		if (!this.child) {
			this.queued.push(line);
			return;
		}
		if (!this.child.stdin.destroyed) this.child.stdin.write(line);
	}

	/** True while the child process is alive. */
	get isRunning(): boolean {
		return (
			this.started &&
			(!this.child || this.child.exitCode === null) &&
			!this.disposed
		);
	}

	/** Terminate the process and release listeners. Safe to call repeatedly. */
	dispose(): void {
		if (this.disposed) return;
		this.permissions.clear();
		this.disposed = true;
		this.cleanupBrowser();
		this.queued = [];
		if (this.child && this.child.exitCode === null) {
			try {
				this.child.stdin.end();
			} catch {}
			this.child.kill();
		}
		this.removeAllListeners();
		this.child = null;
	}
}
