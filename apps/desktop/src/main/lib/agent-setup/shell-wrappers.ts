import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	SUPERSET_MANAGED_BINARIES,
	type SupersetManagedBinary,
} from "./desktop-agent-capabilities";
import { BASH_DIR, BIN_DIR, PWSH_DIR, ZSH_DIR } from "./paths";

export interface ShellWrapperPaths {
	BIN_DIR: string;
	ZSH_DIR: string;
	BASH_DIR: string;
	/** Only the PowerShell wrapper needs this; POSIX call sites may omit it. */
	PWSH_DIR?: string;
}

const DEFAULT_PATHS: ShellWrapperPaths = {
	BIN_DIR,
	ZSH_DIR,
	BASH_DIR,
	PWSH_DIR,
};

const modeDiagnosticsLogged = new Set<string>();

function getShellName(shell: string): string {
	return shell.split("/").pop() || shell;
}

/**
 * Shell snippet to save all SUPERSET_* env vars before sourcing user RC files.
 * Used in tandem with {@link SUPERSET_ENV_RESTORE} to prevent user shell
 * configs from overriding Superset-managed environment variables (e.g.
 * SUPERSET_WORKSPACE_NAME).
 *
 * @see https://github.com/AidenIO/superset/issues/2386
 */
const SUPERSET_ENV_SAVE = `_superset_saved_env="$(export -p 2>/dev/null | grep ' SUPERSET_')"`;

/**
 * Shell snippet to restore previously saved SUPERSET_* env vars after
 * sourcing user RC files.
 */
const SUPERSET_ENV_RESTORE = `eval "$_superset_saved_env" 2>/dev/null || true`;

function quoteShellLiteral(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function logModeDiagnostics(shellName: string): void {
	const key = `${shellName}:native`;
	if (modeDiagnosticsLogged.has(key)) return;
	modeDiagnosticsLogged.add(key);
	console.debug(
		`[agent-setup] shell integration mode=native shell=${shellName}`,
	);
}

function writeFileIfChanged(
	filePath: string,
	content: string,
	mode: number,
): boolean {
	const existing = fs.existsSync(filePath)
		? fs.readFileSync(filePath, "utf-8")
		: null;
	if (existing === content) {
		try {
			fs.chmodSync(filePath, mode);
		} catch {
			// Best effort.
		}
		return false;
	}

	fs.writeFileSync(filePath, content, { mode });
	try {
		fs.chmodSync(filePath, mode);
	} catch {
		// Best effort.
	}
	return true;
}

/**
 * Build shell function wrappers for managed binaries (claude, codex, etc.)
 * that prefer BIN_DIR executables over system-installed ones.
 */
function buildManagedCommandPrelude(shellName: string, binDir: string): string {
	if (shellName === "fish") {
		const escapedBinDir = escapeFishDoubleQuoted(binDir);
		return SUPERSET_MANAGED_BINARIES.map(
			(name: SupersetManagedBinary) =>
				`functions -q ${name}; and functions -e ${name}
function ${name}
  set -l _superset_wrapper "${escapedBinDir}/${name}"
  if test -x "$_superset_wrapper"; and not test -d "$_superset_wrapper"
    "$_superset_wrapper" $argv
  else
    command ${name} $argv
  end
end`,
		).join("\n");
	}

	return SUPERSET_MANAGED_BINARIES.map(
		(name: SupersetManagedBinary) =>
			`unalias ${name} 2>/dev/null || true
${name}() {
  _superset_wrapper=${quoteShellLiteral(`${binDir}/${name}`)}
  if [ -x "$_superset_wrapper" ] && [ ! -d "$_superset_wrapper" ]; then
    "$_superset_wrapper" "$@"
  else
    command ${name} "$@"
  fi
}`,
	).join("\n");
}

/** Build a shell snippet that idempotently prepends BIN_DIR to PATH. */
function buildPathPrependFunction(binDir: string): string {
	return `_superset_prepend_bin() {
  case ":$PATH:" in
    *:${quoteShellLiteral(binDir)}:*) ;;
    *) export PATH=${quoteShellLiteral(binDir)}:"$PATH" ;;
  esac
}
_superset_prepend_bin`;
}

/**
 * Build a zsh precmd hook that re-asserts BIN_DIR in PATH.
 * Tools like mise/asdf register precmd hooks that reconstruct PATH,
 * which can remove our BIN_DIR. This is intentionally best-effort so
 * unusual user zsh configs don't break shell startup.
 */
function buildZshPrecmdHook(binDir: string): string {
	return `typeset -ga precmd_functions 2>/dev/null || true
_superset_ensure_path() {
  case ":$PATH:" in
    *:${quoteShellLiteral(binDir)}:*) ;;
    *) PATH=${quoteShellLiteral(binDir)}:"$PATH" ;;
  esac
}
{
  # Keep our hook last so it wins over other PATH-mutating precmd hooks.
  precmd_functions=(\${precmd_functions:#_superset_ensure_path} _superset_ensure_path)
} 2>/dev/null || true`;
}

function escapeFishDoubleQuoted(value: string): string {
	return value
		.replaceAll("\\", "\\\\")
		.replaceAll('"', '\\"')
		.replaceAll("$", "\\$");
}

export function createZshWrapper(
	paths: ShellWrapperPaths = DEFAULT_PATHS,
): void {
	logModeDiagnostics("zsh");
	const quotedZshDir = quoteShellLiteral(paths.ZSH_DIR);

	// .zshenv is always sourced first by zsh (interactive + non-interactive).
	// Temporarily restore the user's ZDOTDIR while sourcing user config, then
	// switch back so zsh continues through our wrapper chain.
	const zshenvPath = path.join(paths.ZSH_DIR, ".zshenv");
	const zshenvScript = `# Superset zsh env wrapper
${SUPERSET_ENV_SAVE}
_superset_home="\${SUPERSET_ORIG_ZDOTDIR:-$HOME}"
export ZDOTDIR="$_superset_home"
[[ -f "$_superset_home/.zshenv" ]] && source "$_superset_home/.zshenv"
${SUPERSET_ENV_RESTORE}
export ZDOTDIR=${quotedZshDir}
`;
	const wroteZshenv = writeFileIfChanged(zshenvPath, zshenvScript, 0o644);

	// Source user .zprofile with their ZDOTDIR, then restore wrapper ZDOTDIR
	// so startup continues into our .zshrc wrapper.
	const zprofilePath = path.join(paths.ZSH_DIR, ".zprofile");
	const zprofileScript = `# Superset zsh profile wrapper
${SUPERSET_ENV_SAVE}
_superset_home="\${SUPERSET_ORIG_ZDOTDIR:-$HOME}"
export ZDOTDIR="$_superset_home"
[[ -f "$_superset_home/.zprofile" ]] && source "$_superset_home/.zprofile"
${SUPERSET_ENV_RESTORE}
export ZDOTDIR=${quotedZshDir}
`;
	const wroteZprofile = writeFileIfChanged(zprofilePath, zprofileScript, 0o644);

	// Reset ZDOTDIR before sourcing so Oh My Zsh works correctly
	const zshrcPath = path.join(paths.ZSH_DIR, ".zshrc");
	const zshrcScript = `# Superset zsh rc wrapper
${SUPERSET_ENV_SAVE}
_superset_home="\${SUPERSET_ORIG_ZDOTDIR:-$HOME}"
export ZDOTDIR="$_superset_home"
[[ -f "$_superset_home/.zshrc" ]] && source "$_superset_home/.zshrc"
${SUPERSET_ENV_RESTORE}
${buildPathPrependFunction(paths.BIN_DIR)}
${buildZshPrecmdHook(paths.BIN_DIR)}
rehash 2>/dev/null || true
# Restore ZDOTDIR so our .zlogin runs after user's .zlogin
export ZDOTDIR=${quotedZshDir}
`;
	const wroteZshrc = writeFileIfChanged(zshrcPath, zshrcScript, 0o644);

	// .zlogin runs AFTER .zshrc in login shells. By restoring ZDOTDIR above,
	// zsh sources our .zlogin instead of the user's directly. We source the
	// user's .zlogin only for interactive shells, then re-assert Superset's
	// PATH prepend after user startup hooks run.
	const zloginPath = path.join(paths.ZSH_DIR, ".zlogin");
	const zloginScript = `# Superset zsh login wrapper
${SUPERSET_ENV_SAVE}
_superset_home="\${SUPERSET_ORIG_ZDOTDIR:-$HOME}"
export ZDOTDIR="$_superset_home"
if [[ -o interactive ]]; then
  [[ -f "$_superset_home/.zlogin" ]] && source "$_superset_home/.zlogin"
fi
${SUPERSET_ENV_RESTORE}
${buildZshPrecmdHook(paths.BIN_DIR)}
${buildPathPrependFunction(paths.BIN_DIR)}
rehash 2>/dev/null || true
# Shell readiness markers. Emitting both keeps us compatible across daemon
# versions: the legacy v1 daemon scans for OSC 777, the current scanner (v1
# post-refactor + v2 host-service) scans for OSC 133;A (FinalTerm standard).
# Wrappers are rewritten on every app launch, so main always ships the
# superset of markers; daemons that only get restarted on protocol bumps
# still match against their own scanner.
# Protocol ref: https://gitlab.freedesktop.org/Per_Bothner/specifications/blob/master/proposals/semantic-prompts.md
#
# A/B/C/D, not just A. 'A' alone says "a prompt appeared" and nothing else —
# no command boundaries, no exit codes. zsh gives us real preexec/precmd hooks,
# so the full FinalTerm sequence costs nothing extra:
#   A = prompt start, B = command line ends, C = execution begins,
#   D;<code> = command finished. 9;9 reports cwd.
#
# 777;superset-cmd carries the command LINE. Without it a history row knows
# when something ran, where, and whether it worked — but not what it was, which
# is most of the value. zsh hands preexec the line as $1.
#
# Ours rather than VS Code's 633;E: that one percent-encodes its payload, and
# claiming compatibility we hadn't implemented would break the first time a
# command contained a semicolon.
#
# Sanitized, not raw: a command can contain ESC or BEL, either of which would
# terminate the sequence early and corrupt everything after it. Newlines become
# spaces and the two control bytes are dropped outright. Backslashes are left
# ALONE — escaping without a decoder is how every Windows path in history came
# back as C:\\Dev.
__superset_encode() {
  local s="\${1//$'\\n'/ }"
  s="\${s//$'\\r'/ }"
  s="\${s//$'\\e'/}"
  s="\${s//$'\\a'/}"
  printf '%s' "$s"
}
__superset_preexec() {
  __superset_ran=1
  printf "\\033]777;superset-cmd;%s\\007" "$(__superset_encode "$1")"
  printf "\\033]133;B\\007\\033]133;C\\007"
}
__superset_prompt_mark() {
  local ec=$?
  if [[ -n "$__superset_ran" ]]; then
    printf "\\033]133;D;%s\\007" "$ec"
    __superset_ran=
  fi
  printf "\\033]9;9;%s\\007" "$PWD"
  printf "\\033]777;superset-shell-ready\\007\\033]133;A\\007"
}
# Keep our hook LAST so it fires after direnv and other precmd hooks complete.
precmd_functions=(\${precmd_functions[@]} __superset_prompt_mark)
preexec_functions=(\${preexec_functions[@]} __superset_preexec)
export ZDOTDIR="$_superset_home"
`;
	const wroteZlogin = writeFileIfChanged(zloginPath, zloginScript, 0o644);
	const changed = wroteZshenv || wroteZprofile || wroteZshrc || wroteZlogin;
	console.log(
		`[agent-setup] ${changed ? "Updated" : "Verified"} zsh wrapper files`,
	);
}

export function createBashWrapper(
	paths: ShellWrapperPaths = DEFAULT_PATHS,
): void {
	logModeDiagnostics("bash");

	const rcfilePath = path.join(paths.BASH_DIR, "rcfile");
	const script = `# Superset bash rcfile wrapper

# Save Superset env vars before sourcing user config
${SUPERSET_ENV_SAVE}

# Source system profile
[[ -f /etc/profile ]] && source /etc/profile

# Source user's login profile
if [[ -f "$HOME/.bash_profile" ]]; then
  source "$HOME/.bash_profile"
elif [[ -f "$HOME/.bash_login" ]]; then
  source "$HOME/.bash_login"
elif [[ -f "$HOME/.profile" ]]; then
  source "$HOME/.profile"
fi

# Source bashrc if separate
[[ -f "$HOME/.bashrc" ]] && source "$HOME/.bashrc"

# Restore Superset env vars that user config may have overridden
${SUPERSET_ENV_RESTORE}

# Keep superset bin first without duplicating entries
${buildPathPrependFunction(paths.BIN_DIR)}
hash -r 2>/dev/null || true
# Minimal prompt (path/env shown in toolbar) - emerald to match app theme
export PS1=$'\\[\\e[1;38;2;52;211;153m\\]❯\\[\\e[0m\\] '
# Shell readiness markers — see zsh wrapper for rationale on emitting both.
# Protocol ref: https://gitlab.freedesktop.org/Per_Bothner/specifications/blob/master/proposals/semantic-prompts.md
#
# Full A/B/C/D — see the zsh wrapper for the rationale. bash has no preexec, so
# a DEBUG trap stands in for one; the guards below stop it firing for the prompt
# command itself or for our own helpers, which would otherwise mark every prompt
# as a command execution.
#
# See the zsh wrapper for why the command line is sanitized rather than raw. bash has no
# preexec, so $BASH_COMMAND inside the DEBUG trap is the closest thing to the
# line the user submitted.
__superset_encode() {
  local s="\${1//$'\\n'/ }"
  s="\${s//$'\\r'/ }"
  s="\${s//$'\\e'/}"
  s="\${s//$'\\a'/}"
  printf '%s' "$s"
}
__superset_preexec() {
  [[ -n "$__superset_in_prompt" || -n "$__superset_ran" ]] && return
  [[ "$BASH_COMMAND" == *"__superset_"* ]] && return
  __superset_ran=1
  printf "\\033]777;superset-cmd;%s\\007" "$(__superset_encode "$BASH_COMMAND")"
  printf "\\033]133;B\\007\\033]133;C\\007"
}
trap '__superset_preexec' DEBUG
__superset_prompt_mark() {
  local ec=$?
  __superset_in_prompt=1
  if [[ -n "$__superset_ran" ]]; then
    printf "\\033]133;D;%s\\007" "$ec"
    __superset_ran=
  fi
  printf "\\033]9;9;%s\\007" "$PWD"
  printf "\\033]777;superset-shell-ready\\007\\033]133;A\\007"
  __superset_in_prompt=
}
# Hook via PROMPT_COMMAND. Supports both scalar and array forms (Bash 5.1+).
if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]]; then
  PROMPT_COMMAND=("\${PROMPT_COMMAND[@]}" "__superset_prompt_mark")
else
  _superset_orig_prompt_cmd="\${PROMPT_COMMAND}"
  if [[ -n "\${_superset_orig_prompt_cmd}" ]]; then
    PROMPT_COMMAND="\${_superset_orig_prompt_cmd};__superset_prompt_mark"
  else
    PROMPT_COMMAND="__superset_prompt_mark"
  fi
fi
`;
	const changed = writeFileIfChanged(rcfilePath, script, 0o644);
	console.log(`[agent-setup] ${changed ? "Updated" : "Verified"} bash wrapper`);
}

/**
 * PowerShell shell integration — the Windows half we never had.
 *
 * Everything above this emits OSC 133 for zsh/bash/fish, so on the platform
 * GatedSpace is actually built for, terminals reported nothing: no prompt
 * boundaries, no exit codes, no cwd. Anything that wants to know "what command
 * ran, did it work, and where" had no source of truth on Windows.
 *
 * Two hooks are needed because PowerShell has no preexec:
 *  - PSReadLine's Enter key handler fires when the user submits a line, which is
 *    where 133;B (command line ends) and 133;C (execution begins) belong.
 *  - The `prompt` function fires after execution, which is where 133;D carries
 *    the exit code, followed by 9;9 for cwd and 133;A to open the next prompt.
 *
 * $LASTEXITCODE only reflects NATIVE commands; for cmdlets it is stale and `$?`
 * is the truth. Reading both, native-first, is what makes the reported code
 * right for `git status` and `Get-ChildItem` alike.
 *
 * The user's own profile is sourced first and never modified — same contract as
 * the bash rcfile above. Uninstalling is deleting one directory.
 */
export function createPowerShellWrapper(
	paths: ShellWrapperPaths = DEFAULT_PATHS,
): void {
	logModeDiagnostics("powershell");

	const profilePath = path.join(paths.PWSH_DIR ?? PWSH_DIR, "profile.ps1");
	const binDir = paths.BIN_DIR.replaceAll("'", "''");
	const script = `# Superset PowerShell integration. Generated — do not edit.
# Protocol: https://gitlab.freedesktop.org/Per_Bothner/specifications/blob/master/proposals/semantic-prompts.md

# Source the user's own profile FIRST, so their settings win and ours layer on
# top. We never write into their profile; this file is entirely ours.
foreach ($__superset_profile in @(
  $PROFILE.AllUsersAllHosts, $PROFILE.AllUsersCurrentHost,
  $PROFILE.CurrentUserAllHosts, $PROFILE.CurrentUserCurrentHost
)) {
  if ($__superset_profile -and (Test-Path -LiteralPath $__superset_profile)) {
    try { . $__superset_profile } catch { }
  }
}

$global:SUPERSET_SHELL_INTEGRATION = 1
$global:__superset_executing = $false
$global:__superset_esc = [char]27

function global:__superset_emit([string]$payload) {
  # OSC <payload> ST. Write-Host -NoNewline keeps it out of the pipeline.
  Write-Host -NoNewline ("{0}]{1}{0}\\" -f $global:__superset_esc, $payload)
}

# Keep the superset bin directory ahead of system binaries, idempotently.
$global:__superset_bin = '${binDir}'
if ($global:__superset_bin -and (Test-Path -LiteralPath $global:__superset_bin)) {
  $__superset_parts = $env:PATH -split [IO.Path]::PathSeparator
  if ($__superset_parts -notcontains $global:__superset_bin) {
    $env:PATH = $global:__superset_bin + [IO.Path]::PathSeparator + $env:PATH
  }
}

# 133;B = command line ends, 133;C = execution begins. PowerShell has no
# preexec, so the Enter key handler stands in for one.
if (Get-Command Set-PSReadLineKeyHandler -ErrorAction SilentlyContinue) {
  try {
    Set-PSReadLineKeyHandler -Key Enter -ScriptBlock {
      $global:__superset_executing = $true
      # 777;superset-cmd carries the command LINE, read straight out of
      # PSReadLine's buffer before it is submitted. Sanitized the same way as
      # the POSIX wrappers: a command containing ESC or BEL would otherwise
      # terminate the sequence early and corrupt everything after it.
      #
      # Backslashes are NOT escaped. They were once, and since nothing ever
      # unescaped them every Windows path in history came back doubled
      # (C:\\Dev). Escaping only earns its keep when a decoder exists; the
      # payload here ends at ESC \\ or BEL, and a lone backslash is neither.
      try {
        $__bs_line = $null
        $__bs_cursor = $null
        [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState(
          [ref]$__bs_line, [ref]$__bs_cursor)
        if ($__bs_line) {
          # [char] codes rather than PowerShell's backtick escapes: a backtick
          # inside the TypeScript template literal that generates this file
          # terminates the string. Literal .Replace() rather than -replace,
          # so no regex or $-substitution rules apply to a user's command.
          $__bs_line = $__bs_line.Replace([string][char]10,' ')
          $__bs_line = $__bs_line.Replace([string][char]13,' ')
          $__bs_line = $__bs_line.Replace([string][char]27,'')
          $__bs_line = $__bs_line.Replace([string][char]7,'')
          __superset_emit ("777;superset-cmd;{0}" -f $__bs_line)
        }
      } catch { }
      __superset_emit '133;B'
      __superset_emit '133;C'
      [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
    }
  } catch { }
}

$global:__superset_prompt_inner = $function:prompt

function global:prompt {
  # $LASTEXITCODE is only set by NATIVE commands and goes stale for cmdlets,
  # where $? is the truth. Prefer the native code when this turn actually ran
  # one, otherwise fall back to $?.
  $__superset_ok = $?
  $__superset_code = 0
  if ($global:__superset_executing) {
    if ($null -ne $global:LASTEXITCODE -and $global:LASTEXITCODE -ne 0) {
      $__superset_code = [int]$global:LASTEXITCODE
    } elseif (-not $__superset_ok) {
      $__superset_code = 1
    }
    __superset_emit ("133;D;{0}" -f $__superset_code)
    $global:__superset_executing = $false
  }

  # 9;9 reports cwd. FileSystem-provider only: a registry or cert drive is not a
  # path any consumer of this could resolve.
  try {
    if ($ExecutionContext.SessionState.Path.CurrentLocation.Provider.Name -eq 'FileSystem') {
      __superset_emit ("9;9;{0}" -f $ExecutionContext.SessionState.Path.CurrentLocation.Path)
    }
  } catch { }

  __superset_emit '133;A'
  # Legacy readiness marker, matched by the v1 daemon's scanner.
  __superset_emit '777;superset-shell-ready'

  if ($global:__superset_prompt_inner) {
    try { return (& $global:__superset_prompt_inner) } catch { }
  }
  "PS $($ExecutionContext.SessionState.Path.CurrentLocation)> "
}

__superset_emit '133;A'
`;
	const changed = writeFileIfChanged(profilePath, script, 0o644);
	console.log(
		`[agent-setup] ${changed ? "Updated" : "Verified"} powershell wrapper`,
	);
}

export function getShellEnv(
	shell: string,
	paths: ShellWrapperPaths = DEFAULT_PATHS,
): Record<string, string> {
	const shellName = getShellName(shell);
	if (shellName === "zsh") {
		return {
			SUPERSET_ORIG_ZDOTDIR: process.env.ZDOTDIR || os.homedir(),
			ZDOTDIR: paths.ZSH_DIR,
		};
	}
	return {};
}

export function getShellArgs(
	shell: string,
	paths: ShellWrapperPaths = DEFAULT_PATHS,
): string[] {
	const shellName = getShellName(shell);
	logModeDiagnostics(shellName);
	if (shellName === "bash") {
		return ["--rcfile", path.join(paths.BASH_DIR, "rcfile")];
	}
	if (shellName === "fish") {
		// Use --init-command to prepend BIN_DIR to PATH after config is loaded.
		// Use fish list-aware checks to avoid duplicate PATH entries across nested shells.
		// Emit both OSC 777 (legacy v1 daemon) and OSC 133;A (current scanner)
		// on fish_prompt. See zsh wrapper for rationale.
		const escapedBinDir = escapeFishDoubleQuoted(paths.BIN_DIR);
		return [
			"-l",
			"--init-command",
			[
				`set -l _superset_bin "${escapedBinDir}"`,
				`contains -- "$_superset_bin" $PATH`,
				`or set -gx PATH "$_superset_bin" $PATH`,
				`function _superset_prompt_mark --on-event fish_prompt`,
				`printf '\\033]777;superset-shell-ready\\007\\033]133;A\\007'`,
				`end`,
			].join("; "),
		];
	}
	if (["zsh", "sh", "ksh"].includes(shellName)) {
		return ["-l"];
	}
	return [];
}

/**
 * Shell args for non-interactive command execution (`-c`) that sources
 * user profiles via wrappers. Falls back to login shell if wrappers
 * don't exist yet (e.g. before setupAgentHooks runs).
 *
 * Unlike getShellArgs (interactive), we must source profiles inline because:
 * - zsh skips .zshrc for non-interactive shells
 * - bash ignores --rcfile when -c is present
 * - managed binary prelude enforces wrapper paths for app-owned commands
 */
export function getCommandShellArgs(
	shell: string,
	command: string,
	paths: ShellWrapperPaths = DEFAULT_PATHS,
): string[] {
	const shellName = getShellName(shell);
	logModeDiagnostics(shellName);
	const zshRc = path.join(paths.ZSH_DIR, ".zshrc");
	const bashRcfile = path.join(paths.BASH_DIR, "rcfile");
	const commandWithManagedPrelude = `${buildManagedCommandPrelude(shellName, paths.BIN_DIR)}\n${command}`;
	if (shellName === "zsh" && fs.existsSync(zshRc)) {
		return [
			"-lc",
			`source ${quoteShellLiteral(zshRc)} &&\n${commandWithManagedPrelude}`,
		];
	}
	if (shellName === "bash" && fs.existsSync(bashRcfile)) {
		return [
			"-c",
			`source ${quoteShellLiteral(bashRcfile)} &&\n${commandWithManagedPrelude}`,
		];
	}
	return ["-lc", commandWithManagedPrelude];
}
