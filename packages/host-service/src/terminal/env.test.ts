import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	buildV2TerminalEnv,
	getShellBootstrapEnv,
	getShellLaunchArgs,
	getTerminalBaseEnv,
	initTerminalBaseEnv,
	normalizeUtf8Locale,
	resetTerminalBaseEnvForTests,
	resolveLaunchShell,
	stripTerminalRuntimeEnv,
} from "./env";

// ── resolveLaunchShell ───────────────────────────────────────────────

describe("resolveLaunchShell", () => {
	test("prefers the configured account shell over inherited SHELL", () => {
		expect(
			resolveLaunchShell(
				{ SHELL: "/bin/bash" },
				{ accountShell: "/opt/homebrew/bin/fish", platform: "darwin" },
			),
		).toBe("/opt/homebrew/bin/fish");
	});

	test("falls back to SHELL from base env when account shell is unavailable", () => {
		expect(
			resolveLaunchShell(
				{ SHELL: "/usr/local/bin/fish" },
				{ accountShell: null, platform: "darwin" },
			),
		).toBe("/usr/local/bin/fish");
	});

	test("falls back to /bin/sh when SHELL is absent", () => {
		expect(
			resolveLaunchShell({}, { accountShell: null, platform: "darwin" }),
		).toBe("/bin/sh");
	});

	test("does not default to /bin/zsh", () => {
		expect(
			resolveLaunchShell({}, { accountShell: null, platform: "darwin" }),
		).not.toBe("/bin/zsh");
	});

	// ── Windows ────────────────────────────────────────────────────────
	//
	// The base env is a plain-object snapshot of process.env, and Windows
	// spells the key `ComSpec`. process.env is case-insensitive; a plain object
	// is not — so the old `env.COMSPEC` lookup missed on every real machine and
	// silently produced a bare "cmd.exe". That then failed for real inside
	// node-pty, which resolves a relative shell against the pty-daemon's own
	// cwd and returns nothing when it hits.

	// A SystemRoot that cannot contain an in-box PowerShell, so these exercise
	// the cmd.exe fallback chain deterministically on any machine.
	const NO_PWSH = "Z:\\NoSuchWindowsRoot";

	test("finds ComSpec however Windows happened to spell it", () => {
		for (const key of ["ComSpec", "COMSPEC", "comspec"]) {
			expect(
				resolveLaunchShell(
					{ [key]: "C:\\WINDOWS\\system32\\cmd.exe", SystemRoot: NO_PWSH },
					{ platform: "win32" },
				),
			).toBe("C:\\WINDOWS\\system32\\cmd.exe");
		}
	});

	test("builds an absolute path from SystemRoot when ComSpec is missing", () => {
		expect(
			resolveLaunchShell({ SystemRoot: NO_PWSH }, { platform: "win32" }),
		).toBe(`${NO_PWSH}\\System32\\cmd.exe`);
	});

	test("accepts windir as the anchor too", () => {
		expect(resolveLaunchShell({ windir: NO_PWSH }, { platform: "win32" })).toBe(
			`${NO_PWSH}\\System32\\cmd.exe`,
		);
	});

	test("a relative ComSpec is upgraded, not trusted", () => {
		// "cmd.exe" as ComSpec is the exact value that kills node-pty. Prefer
		// anything absolute over it.
		expect(
			resolveLaunchShell(
				{ ComSpec: "cmd.exe", SystemRoot: NO_PWSH },
				{ platform: "win32" },
			),
		).toBe(`${NO_PWSH}\\System32\\cmd.exe`);
	});

	test("only falls back to a bare name with nothing left to anchor to", () => {
		expect(resolveLaunchShell({}, { platform: "win32" })).toBe("cmd.exe");
	});

	test("blank values don't count as an anchor", () => {
		expect(
			resolveLaunchShell(
				{ ComSpec: "   ", SystemRoot: NO_PWSH },
				{ platform: "win32" },
			),
		).toBe(`${NO_PWSH}\\System32\\cmd.exe`);
	});

	test("prefers the in-box PowerShell over cmd.exe when it exists", () => {
		// PowerShell is the shell Windows users work in, it's what our OSC 133
		// integration targets, and 5.1 ships in-box. cmd.exe is only a fallback.
		// Only meaningful on a real Windows host, so assert conditionally rather
		// than skip: on other platforms the win32 branch still has to fall back.
		const systemRoot = process.env.SystemRoot;
		if (process.platform !== "win32" || !systemRoot) return;
		expect(
			resolveLaunchShell({ SystemRoot: systemRoot }, { platform: "win32" }),
		).toBe(`${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`);
	});
});

// ── normalizeUtf8Locale ──────────────────────────────────────────────

describe("normalizeUtf8Locale", () => {
	test("LC_ALL takes precedence over LANG (POSIX)", () => {
		expect(
			normalizeUtf8Locale({ LC_ALL: "fr_FR.UTF-8", LANG: "en_US.UTF-8" }),
		).toBe("fr_FR.UTF-8");
	});

	test("falls back to LANG when LC_ALL is absent", () => {
		expect(normalizeUtf8Locale({ LANG: "ja_JP.UTF-8" })).toBe("ja_JP.UTF-8");
	});

	test("matches case-insensitive utf8 variants", () => {
		expect(normalizeUtf8Locale({ LANG: "en_US.utf8" })).toBe("en_US.utf8");
		expect(normalizeUtf8Locale({ LC_ALL: "C.UTF8" })).toBe("C.UTF8");
	});

	test("defaults to en_US.UTF-8", () => {
		expect(normalizeUtf8Locale({})).toBe("en_US.UTF-8");
	});

	test("ignores non-UTF-8 locales", () => {
		expect(normalizeUtf8Locale({ LANG: "C", LC_ALL: "POSIX" })).toBe(
			"en_US.UTF-8",
		);
	});
});

// ── stripTerminalRuntimeEnv ──────────────────────────────────────────

describe("stripTerminalRuntimeEnv", () => {
	const secretsEnv: Record<string, string> = {
		// Host-service runtime keys that must not leak
		AUTH_TOKEN: "secret-token",
		SUPERSET_AUTH_CONFIG_PATH: "/Users/test/.superset/config.json",
		HOST_SERVICE_SECRET: "secret",
		ORGANIZATION_ID: "org-123",
		HOST_CLIENT_ID: "device-abc",
		HOST_NAME: "My Mac",
		ELECTRON_RUN_AS_NODE: "1",
		HOST_DB_PATH: "/tmp/host.db",
		HOST_MANIFEST_DIR: "/tmp/manifests",
		HOST_MIGRATIONS_PATH: "/tmp/migrations",
		HOST_SERVICE_VERSION: "1.2.3",
		KEEP_ALIVE_AFTER_PARENT: "1",
		SUPERSET_API_URL: "https://api.example.com",
		DESKTOP_VITE_PORT: "5173",
		// Node/app keys
		NODE_ENV: "development",
		NODE_OPTIONS: "--max-old-space-size=4096",
		NODE_PATH: "/some/path",
		// Dev-runner and Electron runtime vars
		npm_package_name: "superset",
		npm_config_registry: "https://registry.npmjs.org",
		npm_lifecycle_event: "dev",
		ELECTRON_ENABLE_LOGGING: "1",
		// Build-tool prefix keys
		VITE_API_URL: "http://localhost:3000",
		NEXT_PUBLIC_KEY: "pk_123",
		TURBO_TEAM: "my-team",
		// Legacy SUPERSET_* vars that should be stripped
		SUPERSET_PANE_ID: "pane-1",
		SUPERSET_TAB_ID: "tab-1",
		SUPERSET_PORT: "51741",
		SUPERSET_HOOK_VERSION: "2",
		SUPERSET_WORKSPACE_NAME: "my-ws",
		// Auth refresh tokens inherited from parent (CLI/desktop) env
		OAUTH_REFRESH_TOKEN: "oauth-refresh-secret",
		SUPERSET_REFRESH_TOKEN: "superset-refresh-secret",
		// Keys that SHOULD survive
		HOME: "/Users/test",
		PATH: "/usr/bin:/usr/local/bin",
		SHELL: "/bin/zsh",
		EDITOR: "vim",
		SUPERSET_HOME_DIR: "/Users/test/.superset",
		SUPERSET_AGENT_HOOK_PORT: "51741",
		SUPERSET_AGENT_HOOK_VERSION: "2",
	};

	test("app/runtime secrets do not reach PTY env", () => {
		const result = stripTerminalRuntimeEnv(secretsEnv);
		expect(result.AUTH_TOKEN).toBeUndefined();
		expect(result.SUPERSET_AUTH_CONFIG_PATH).toBeUndefined();
		expect(result.HOST_SERVICE_SECRET).toBeUndefined();
		expect(result.ORGANIZATION_ID).toBeUndefined();
		expect(result.HOST_CLIENT_ID).toBeUndefined();
		expect(result.ELECTRON_RUN_AS_NODE).toBeUndefined();
		expect(result.HOST_DB_PATH).toBeUndefined();
		expect(result.SUPERSET_API_URL).toBeUndefined();
		expect(result.DESKTOP_VITE_PORT).toBeUndefined();
	});

	test("host-service control vars do not reach PTY env", () => {
		const result = stripTerminalRuntimeEnv(secretsEnv);
		expect(result.HOST_MANIFEST_DIR).toBeUndefined();
		expect(result.HOST_MIGRATIONS_PATH).toBeUndefined();
		expect(result.HOST_SERVICE_VERSION).toBeUndefined();
		expect(result.KEEP_ALIVE_AFTER_PARENT).toBeUndefined();
		expect(result.HOST_NAME).toBeUndefined();
	});

	test("Node/app keys are stripped", () => {
		const result = stripTerminalRuntimeEnv(secretsEnv);
		expect(result.NODE_ENV).toBeUndefined();
		expect(result.NODE_OPTIONS).toBeUndefined();
		expect(result.NODE_PATH).toBeUndefined();
	});

	test("dev-runner and Electron runtime vars do not reach PTY env", () => {
		const result = stripTerminalRuntimeEnv(secretsEnv);
		expect(result.npm_package_name).toBeUndefined();
		expect(result.npm_config_registry).toBeUndefined();
		expect(result.npm_lifecycle_event).toBeUndefined();
		expect(result.ELECTRON_ENABLE_LOGGING).toBeUndefined();
	});

	test("refresh tokens do not reach PTY env", () => {
		const result = stripTerminalRuntimeEnv(secretsEnv);
		expect(result.OAUTH_REFRESH_TOKEN).toBeUndefined();
		expect(result.SUPERSET_REFRESH_TOKEN).toBeUndefined();
	});

	test("inherited agent-harness vars do not reach PTY env", () => {
		// The app itself may have been launched from inside an AI agent's tool
		// shell (agent-driven relaunch, VS Code extension shell). Its session
		// vars must not leak into terminals: NO_COLOR turns Claude panes
		// monochrome, CLAUDECODE/CLAUDE_CODE_* make nested agents think they
		// are child sessions, CLAUDE_CONFIG_DIR hijacks account routing.
		const result = stripTerminalRuntimeEnv({
			CLAUDECODE: "1",
			NO_COLOR: "1",
			GIT_TERMINAL_PROMPT: "0",
			CLAUDE_CODE_ENTRYPOINT: "claude-vscode",
			CLAUDE_CODE_SESSION_ID: "00000000-0000-0000-0000-000000000000",
			CLAUDE_CONFIG_DIR: "/Users/test/.claude-other",
			CLAUDE_PID: "1234",
			PATH: "/usr/bin",
		});
		expect(result.CLAUDECODE).toBeUndefined();
		expect(result.NO_COLOR).toBeUndefined();
		expect(result.GIT_TERMINAL_PROMPT).toBeUndefined();
		expect(result.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
		expect(result.CLAUDE_CODE_SESSION_ID).toBeUndefined();
		expect(result.CLAUDE_CONFIG_DIR).toBeUndefined();
		expect(result.CLAUDE_PID).toBeUndefined();
		expect(result.PATH).toBe("/usr/bin");
	});

	test("HOST_* prefix is stripped, DESKTOP_* exact keys only", () => {
		const env: Record<string, string> = {
			// HOST_* prefix: all stripped (including HOST_CLIENT_ID, HOST_NAME)
			HOST_DB_PATH: "/tmp/db",
			HOST_MANIFEST_DIR: "/tmp/manifests",
			HOST_SERVICE_SECRET: "secret",
			HOST_CLIENT_ID: "abc",
			HOST_NAME: "Mac",
			// DESKTOP_*: only our exact key stripped
			DESKTOP_VITE_PORT: "5173",
			// Legitimate Linux desktop vars: must survive
			DESKTOP_SESSION: "gnome",
			DESKTOP_STARTUP_ID: "startup-123",
			HOME: "/Users/test",
		};
		const result = stripTerminalRuntimeEnv(env);
		expect(result.HOST_DB_PATH).toBeUndefined();
		expect(result.HOST_MANIFEST_DIR).toBeUndefined();
		expect(result.HOST_SERVICE_SECRET).toBeUndefined();
		expect(result.DESKTOP_VITE_PORT).toBeUndefined();
		expect(result.HOST_CLIENT_ID).toBeUndefined();
		expect(result.HOST_NAME).toBeUndefined();
		// Linux desktop vars preserved
		expect(result.DESKTOP_SESSION).toBe("gnome");
		expect(result.DESKTOP_STARTUP_ID).toBe("startup-123");
		expect(result.HOME).toBe("/Users/test");
	});

	test("build-tool prefix keys are stripped", () => {
		const result = stripTerminalRuntimeEnv(secretsEnv);
		expect(result.VITE_API_URL).toBeUndefined();
		expect(result.NEXT_PUBLIC_KEY).toBeUndefined();
		expect(result.TURBO_TEAM).toBeUndefined();
	});

	test("removed legacy vars do not reach PTY env", () => {
		const result = stripTerminalRuntimeEnv(secretsEnv);
		expect(result.SUPERSET_PANE_ID).toBeUndefined();
		expect(result.SUPERSET_TAB_ID).toBeUndefined();
		expect(result.SUPERSET_PORT).toBeUndefined();
		expect(result.SUPERSET_HOOK_VERSION).toBeUndefined();
		expect(result.SUPERSET_WORKSPACE_NAME).toBeUndefined();
	});

	test("user shell env vars survive stripping", () => {
		const result = stripTerminalRuntimeEnv(secretsEnv);
		expect(result.HOME).toBe("/Users/test");
		expect(result.PATH).toBe("/usr/bin:/usr/local/bin");
		expect(result.SHELL).toBe("/bin/zsh");
		expect(result.EDITOR).toBe("vim");
	});

	test("explicit Superset support keys are kept", () => {
		const result = stripTerminalRuntimeEnv(secretsEnv);
		expect(result.SUPERSET_HOME_DIR).toBe("/Users/test/.superset");
		expect(result.SUPERSET_AGENT_HOOK_PORT).toBe("51741");
		expect(result.SUPERSET_AGENT_HOOK_VERSION).toBe("2");
	});

	test("shell-derived env preserves user tooling vars", () => {
		const shellEnv: Record<string, string> = {
			HOME: "/Users/dev",
			PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin",
			SHELL: "/bin/zsh",
			NVM_DIR: "/Users/dev/.nvm",
			PYENV_ROOT: "/Users/dev/.pyenv",
			GOPATH: "/Users/dev/go",
			SSH_AUTH_SOCK: "/tmp/ssh-agent.sock",
		};
		const result = stripTerminalRuntimeEnv(shellEnv);
		expect(result.NVM_DIR).toBe("/Users/dev/.nvm");
		expect(result.PYENV_ROOT).toBe("/Users/dev/.pyenv");
		expect(result.GOPATH).toBe("/Users/dev/go");
		expect(result.SSH_AUTH_SOCK).toBe("/tmp/ssh-agent.sock");
	});
});

// ── Shell launch behavior ────────────────────────────────────────────

describe("getShellLaunchArgs", () => {
	const supersetHomeDir = "/tmp/test-superset";

	test("zsh launches as login shell", () => {
		expect(getShellLaunchArgs({ shell: "/bin/zsh", supersetHomeDir })).toEqual([
			"-l",
		]);
	});

	test("bash falls back to login shell when rcfile missing", () => {
		const args = getShellLaunchArgs({ shell: "/bin/bash", supersetHomeDir });
		expect(args).toEqual(["-l"]);
	});

	test("fish uses init-command", () => {
		const args = getShellLaunchArgs({
			shell: "/usr/bin/fish",
			supersetHomeDir,
		});
		expect(args[0]).toBe("-l");
		expect(args[1]).toBe("--init-command");
		expect(args[2]).toContain("_superset_bin");
		expect(args[2]).toContain("133;A");
	});

	test("sh launches as login shell", () => {
		expect(getShellLaunchArgs({ shell: "/bin/sh", supersetHomeDir })).toEqual([
			"-l",
		]);
	});

	test("ksh launches as login shell", () => {
		expect(
			getShellLaunchArgs({ shell: "/usr/bin/ksh", supersetHomeDir }),
		).toEqual(["-l"]);
	});

	test("powershell launches interactive even without an integration profile", () => {
		// -NoExit is what keeps it interactive; without it PowerShell would run
		// and leave. A missing profile degrades to a plain shell, never to a
		// terminal that won't open.
		expect(
			getShellLaunchArgs({ shell: "/usr/bin/pwsh", supersetHomeDir }),
		).toEqual(["-NoLogo", "-NoExit"]);
	});

	test("powershell dot-sources the integration profile when present", () => {
		// A REAL temp dir: the shared supersetHomeDir above is deliberately a
		// path that doesn't exist, which is what makes the negative cases honest.
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "gs-pwsh-"));
		const pwshDir = path.join(home, "pwsh");
		fs.mkdirSync(pwshDir, { recursive: true });
		const profile = path.join(pwshDir, "profile.ps1");
		fs.writeFileSync(profile, "# test\n");

		const args = getShellLaunchArgs({
			shell: "C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
			supersetHomeDir: home,
		});
		expect(args.slice(0, 3)).toEqual(["-NoLogo", "-NoExit", "-Command"]);
		// try/catch so a broken profile can't stop a terminal from opening.
		expect(args[3]).toBe(`try { . '${profile}' } catch { }`);
	});

	test("a .exe suffix and backslashes don't hide the shell's identity", () => {
		// path.basename on a POSIX host does not split on backslashes, and the
		// Windows shell arrives as an absolute path WITH an extension.
		expect(
			getShellLaunchArgs({
				shell: "C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
				supersetHomeDir,
			}),
		).not.toEqual([]);
	});

	test("genuinely unsupported shells still launch natively", () => {
		expect(
			getShellLaunchArgs({ shell: "/usr/bin/nushell", supersetHomeDir }),
		).toEqual([]);
	});
});

describe("getShellBootstrapEnv", () => {
	test("zsh bootstrap applies only when wrapper files exist", () => {
		const result = getShellBootstrapEnv({
			shell: "/bin/zsh",
			baseEnv: { HOME: "/Users/test" },
			supersetHomeDir: "/tmp/nonexistent-superset-dir",
		});
		expect(result).toEqual({});
	});

	test("bash returns no bootstrap env keys", () => {
		const result = getShellBootstrapEnv({
			shell: "/bin/bash",
			baseEnv: {},
			supersetHomeDir: "/tmp/test",
		});
		expect(result).toEqual({});
	});

	test("fish returns no bootstrap env keys", () => {
		const result = getShellBootstrapEnv({
			shell: "/usr/bin/fish",
			baseEnv: {},
			supersetHomeDir: "/tmp/test",
		});
		expect(result).toEqual({});
	});

	test("unsupported shells return no bootstrap env", () => {
		const result = getShellBootstrapEnv({
			shell: "/usr/bin/pwsh",
			baseEnv: {},
			supersetHomeDir: "/tmp/test",
		});
		expect(result).toEqual({});
	});
});

// ── Terminal base env preservation ───────────────────────────────────

/**
 * Windows normalises env-var case: assigning `process.env.PATH` writes through
 * to the existing `Path`, so a plain-object snapshot comes back spelled the
 * Windows way. Read it back the way the platform stores it rather than the way
 * the test wrote it — the snapshot is still correct, only the key differs.
 */
function readEnv(env: Record<string, string>, key: string): string | undefined {
	if (env[key] !== undefined) return env[key];
	const wanted = key.toLowerCase();
	return Object.entries(env).find(([k]) => k.toLowerCase() === wanted)?.[1];
}

describe("terminal base env preservation", () => {
	test("getTerminalBaseEnv throws when not initialized", () => {
		resetTerminalBaseEnvForTests();
		expect(() => getTerminalBaseEnv()).toThrow("not initialized");
	});

	test("PTY env is built from preserved snapshot, not live process.env", () => {
		resetTerminalBaseEnvForTests();

		// Simulate host-service startup: process.env = shellSnapshot + runtime keys
		const originalProcessEnv = { ...process.env };
		try {
			// Set up process.env as if desktop spawned host-service
			process.env.HOME = "/Users/test";
			process.env.PATH = "/usr/bin";
			process.env.SHELL = "/bin/zsh";
			process.env.NVM_DIR = "/Users/test/.nvm";
			// Runtime keys that should be stripped
			process.env.HOST_SERVICE_SECRET = "secret-123";
			process.env.ORGANIZATION_ID = "org-abc";
			process.env.ELECTRON_RUN_AS_NODE = "1";

			initTerminalBaseEnv();

			const baseEnv = getTerminalBaseEnv();

			// Shell vars preserved
			expect(readEnv(baseEnv, "HOME")).toBe("/Users/test");
			expect(readEnv(baseEnv, "PATH")).toBe("/usr/bin");
			expect(readEnv(baseEnv, "SHELL")).toBe("/bin/zsh");
			expect(readEnv(baseEnv, "NVM_DIR")).toBe("/Users/test/.nvm");

			// Runtime keys stripped
			expect(readEnv(baseEnv, "HOST_SERVICE_SECRET")).toBeUndefined();
			expect(readEnv(baseEnv, "ORGANIZATION_ID")).toBeUndefined();
			expect(readEnv(baseEnv, "ELECTRON_RUN_AS_NODE")).toBeUndefined();

			// Modify process.env after init — preserved snapshot unaffected
			process.env.INJECTED_LATER = "should-not-appear";
			const freshBaseEnv = getTerminalBaseEnv();
			expect(freshBaseEnv.INJECTED_LATER).toBeUndefined();
		} finally {
			// Restore original process.env
			for (const key of Object.keys(process.env)) {
				if (!(key in originalProcessEnv)) {
					delete process.env[key];
				}
			}
			for (const [key, value] of Object.entries(originalProcessEnv)) {
				process.env[key] = value;
			}
			resetTerminalBaseEnvForTests();
		}
	});

	test("shell resolution failure means no terminal base env", () => {
		resetTerminalBaseEnvForTests();
		// Without calling initTerminalBaseEnv(), getTerminalBaseEnv throws
		expect(() => getTerminalBaseEnv()).toThrow();
	});
});

// ── buildV2TerminalEnv ───────────────────────────────────────────────

describe("buildV2TerminalEnv", () => {
	const baseParams = {
		baseEnv: {
			HOME: "/Users/test",
			PATH: "/usr/bin",
			SHELL: "/bin/zsh",
			SUPERSET_HOME_DIR: "/Users/test/.superset",
		},
		shell: "/bin/zsh",
		supersetHomeDir: "/Users/test/.superset",
		cwd: "/tmp/workspace",
		terminalId: "term-1",
		workspaceId: "ws-1",
		workspacePath: "/tmp/workspace",
		rootPath: "/tmp/repo",
		supersetEnv: "production" as const,
		agentHookPort: "51741",
		agentHookVersion: "2",
	};

	test("injects the public terminal contract and retained v2 metadata", () => {
		const env = buildV2TerminalEnv(baseParams);
		expect(env).toMatchObject({
			TERM: "xterm-256color",
			TERM_PROGRAM: "vscode",
			TERM_PROGRAM_VERSION: "1.128.0",
			COLORTERM: "truecolor",
			PWD: "/tmp/workspace",
			SUPERSET_TERMINAL_ID: "term-1",
			SUPERSET_WORKSPACE_ID: "ws-1",
			SUPERSET_WORKSPACE_PATH: "/tmp/workspace",
			SUPERSET_ROOT_PATH: "/tmp/repo",
			SUPERSET_ENV: "production",
			SUPERSET_AGENT_HOOK_PORT: "51741",
			SUPERSET_AGENT_HOOK_VERSION: "2",
		});
		expect(env.TERM_PROGRAM).toBe("vscode");
		expect(env.SHELL).toBe("/bin/zsh");
		expect(env.LANG).toContain("UTF-8");
	});

	test("sets SHELL to the selected launch shell even when base env was stale", () => {
		const env = buildV2TerminalEnv({
			...baseParams,
			baseEnv: { ...baseParams.baseEnv, SHELL: "/bin/bash" },
			shell: "/opt/homebrew/bin/fish",
		});
		expect(env.SHELL).toBe("/opt/homebrew/bin/fish");
	});

	test("allows empty root path and alternate Superset env without breaking the contract", () => {
		const env = buildV2TerminalEnv({ ...baseParams, rootPath: "" });
		expect(env.SUPERSET_ROOT_PATH).toBe("");

		const devEnv = buildV2TerminalEnv({
			...baseParams,
			rootPath: "",
			supersetEnv: "development",
		});
		expect(devEnv.SUPERSET_ENV).toBe("development");
		expect(devEnv.SUPERSET_ROOT_PATH).toBe("");
	});

	test("defaults COLORFGBG to dark mode", () => {
		const env = buildV2TerminalEnv(baseParams);
		expect(env.COLORFGBG).toBe("15;0");
	});

	test("sets COLORFGBG to light mode when themeType is light", () => {
		const env = buildV2TerminalEnv({
			...baseParams,
			themeType: "light",
		});
		expect(env.COLORFGBG).toBe("0;15");
	});

	test("defaults TERM_THEME to dark", () => {
		const env = buildV2TerminalEnv(baseParams);
		expect(env.TERM_THEME).toBe("dark");
	});

	test("sets TERM_THEME to dark when themeType is dark", () => {
		const env = buildV2TerminalEnv({
			...baseParams,
			themeType: "dark",
		});
		expect(env.TERM_THEME).toBe("dark");
	});

	test("sets TERM_THEME to light when themeType is light", () => {
		const env = buildV2TerminalEnv({
			...baseParams,
			themeType: "light",
		});
		expect(env.TERM_THEME).toBe("light");
	});

	test("drops removed v1 metadata while preserving user shell vars", () => {
		const env = buildV2TerminalEnv({
			...baseParams,
			baseEnv: {
				...baseParams.baseEnv,
				SUPERSET_PANE_ID: "pane-1",
				SUPERSET_TAB_ID: "tab-1",
				SUPERSET_PORT: "51741",
				SUPERSET_HOOK_VERSION: "2",
				SUPERSET_WORKSPACE_NAME: "my-workspace",
				NVM_DIR: "/Users/test/.nvm",
				SSH_AUTH_SOCK: "/tmp/ssh.sock",
			},
		});
		expect(env.SUPERSET_PANE_ID).toBeUndefined();
		expect(env.SUPERSET_TAB_ID).toBeUndefined();
		expect(env.SUPERSET_PORT).toBeUndefined();
		expect(env.SUPERSET_HOOK_VERSION).toBeUndefined();
		expect(env.SUPERSET_WORKSPACE_NAME).toBeUndefined();
		expect(env.NVM_DIR).toBe("/Users/test/.nvm");
		expect(env.SSH_AUTH_SOCK).toBe("/tmp/ssh.sock");
	});
});

// ── Integration: env never degenerates to process.env ────────────────

describe("v2 env contract boundary", () => {
	test("runtime secrets in base env are stripped even when present", () => {
		// Simulate a base env that somehow has runtime secrets
		// (e.g. from shell snapshot contamination)
		const env = buildV2TerminalEnv({
			baseEnv: {
				HOME: "/Users/test",
				PATH: "/usr/bin",
				SHELL: "/bin/zsh",
				HOST_SERVICE_SECRET: "top-secret",
				AUTH_TOKEN: "bearer-xyz",
				ORGANIZATION_ID: "org-abc",
				NODE_ENV: "production",
				VITE_SECRET: "vite-key",
				npm_package_name: "superset",
				ELECTRON_IS_DEV: "1",
			},
			shell: "/bin/zsh",
			supersetHomeDir: "/Users/test/.superset",
			cwd: "/tmp/ws",
			terminalId: "t-1",
			workspaceId: "w-1",
			workspacePath: "/tmp/ws",
			rootPath: "",
			supersetEnv: "production",
			agentHookPort: "51741",
			agentHookVersion: "2",
		});

		// None of the runtime secrets should be present
		expect(env.HOST_SERVICE_SECRET).toBeUndefined();
		expect(env.AUTH_TOKEN).toBeUndefined();
		expect(env.ORGANIZATION_ID).toBeUndefined();
		expect(env.NODE_ENV).toBeUndefined();
		expect(env.VITE_SECRET).toBeUndefined();
		expect(env.npm_package_name).toBeUndefined();
		expect(env.ELECTRON_IS_DEV).toBeUndefined();

		// But user shell vars remain
		expect(env.HOME).toBe("/Users/test");
		expect(env.PATH).toBe("/usr/bin");
		expect(env.SHELL).toBe("/bin/zsh");
	});
});
