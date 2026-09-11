import fs from "node:fs";
import path from "node:path";
import { SUPERSET_MANAGED_BINARIES } from "./desktop-agent-capabilities";
import { NOTIFY_SCRIPT_NAME } from "./notify-hook";
import { BIN_DIR, HOOKS_DIR } from "./paths";

export const WRAPPER_MARKER = "# Superset agent-wrapper v3";
export { SUPERSET_MANAGED_BINARIES };

/** Path (under SUPERSET_HOME_DIR) of the runtime notify hook script. */
export const MANAGED_NOTIFY_RELATIVE_PATH = `hooks/${NOTIFY_SCRIPT_NAME}`;

/**
 * Shell command written into an agent's global hook config. The notify path is
 * resolved at runtime from SUPERSET_HOME_DIR so one shared config works for both
 * dev and prod installs, and `SUPERSET_AGENT_ID` is inlined so the v2 hook
 * payload carries wrapper-level identity even when the agent is launched outside
 * the Superset wrapper (system PATH resolves the real binary directly).
 */
export function getManagedNotifyHookCommand(agentId: string): string {
	// Windows: hook runners execute commands via cmd (no /bin/sh), which
	// cannot parse the POSIX guard below — run the hook through Git Bash
	// with a baked absolute path (forward slashes so bash can exec it; the
	// ".superset/…notify.sh" substring keeps managed-entry matching intact).
	if (process.platform === "win32") {
		const notifyPosix = path
			.join(HOOKS_DIR, NOTIFY_SCRIPT_NAME)
			.replaceAll("\\", "/");
		return `"C:\\Program Files\\Git\\bin\\bash.exe" -c "SUPERSET_AGENT_ID=${agentId} '${notifyPosix}' || true"`;
	}
	return `[ -n "$SUPERSET_HOME_DIR" ] && [ -x "$SUPERSET_HOME_DIR/${MANAGED_NOTIFY_RELATIVE_PATH}" ] && SUPERSET_AGENT_ID=${agentId} "$SUPERSET_HOME_DIR/${MANAGED_NOTIFY_RELATIVE_PATH}" || true`;
}

// Dev setup (.superset/lib/setup/steps.sh) points SUPERSET_HOME_DIR at
// $PWD/superset-dev-data — without a leading dot — so we must recognize that
// variant to reap stale notify.sh paths from deleted worktrees.
const SUPERSET_MANAGED_HOOK_PATH_PATTERN =
	/\/(?:\.superset(?:-[^/'"\s\\]+)?|superset-dev-data)\//;

export function writeFileIfChanged(
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
	return true;
}

export function isSupersetManagedHookCommand(
	command: string | undefined,
	scriptName: string,
): boolean {
	if (!command) return false;
	const normalized = command.replaceAll("\\", "/");
	if (!normalized.includes(`/hooks/${scriptName}`)) return false;
	return SUPERSET_MANAGED_HOOK_PATH_PATTERN.test(normalized);
}

interface ReconcileManagedEntriesOptions<T> {
	current: T[] | undefined;
	desired: T[];
	isManaged: (entry: T) => boolean;
	isEquivalent: (entry: T, desiredEntry: T) => boolean;
}

interface ReconcileManagedEntriesResult<T> {
	entries: T[];
	replacedManagedEntries: T[];
}

export function reconcileManagedEntries<T>({
	current,
	desired,
	isManaged,
	isEquivalent,
}: ReconcileManagedEntriesOptions<T>): ReconcileManagedEntriesResult<T> {
	const existing = Array.isArray(current) ? current : [];
	const entries: T[] = [];
	const replacedManagedEntries: T[] = [];

	for (const entry of existing) {
		if (!isManaged(entry)) {
			entries.push(entry);
			continue;
		}

		if (!desired.some((desiredEntry) => isEquivalent(entry, desiredEntry))) {
			replacedManagedEntries.push(entry);
		}
	}

	entries.push(...desired);

	return { entries, replacedManagedEntries };
}

/**
 * Find the REAL binary on PATH, skipping our own wrappers.
 *
 * The string comparison below is not enough on Windows, and the failure is a
 * fork bomb rather than a missing binary. `BIN_DIR` is baked in by Node, so it
 * reads `C:\Users\you\.superset\bin`, while `$PATH` inside Git Bash arrives
 * as `/c/Users/you/.superset/bin`. Those never match, so a wrapper that cannot
 * recognise its own directory finds ITSELF, execs itself, and forks until bash
 * gives up — observed as `shell level (1000) too high`.
 *
 * It is masked on a default install only because the `"$HOME"/.superset/bin`
 * pattern happens to match in POSIX form. It is NOT masked when
 * `SUPERSET_HOME_DIR` points somewhere else, which is exactly what dev mode
 * does (`superset-dev-data`), and it became reachable at all once the `.cmd`
 * shims made these wrappers executable on Windows.
 *
 * So the real guard is `-ef`, which compares the FILE rather than the spelling
 * of the path and is immune to every form difference. The string cases stay as
 * a cheap first pass on POSIX.
 */
function buildRealBinaryResolver(): string {
	return `find_real_binary() {
  local name="$1"
  local candidate
  local IFS=:
  for dir in $PATH; do
    [ -z "$dir" ] && continue
    dir="\${dir%/}"
    case "$dir" in
      "${BIN_DIR}"|"$HOME"/.superset/bin|"$HOME"/.superset-*/bin) continue ;;
    esac
    candidate="$dir/$name"
    [ -x "$candidate" ] || continue
    [ -d "$candidate" ] && continue
    if [ -n "$SUPERSET_WRAPPER_SELF" ] && [ "$candidate" -ef "$SUPERSET_WRAPPER_SELF" ]; then
      continue
    fi
    printf "%s\\n" "$candidate"
    return 0
  done
  return 1
}
`;
}

function getMissingBinaryMessage(name: string): string {
	return `Superset: ${name} not found in PATH. Install it and ensure it is on PATH, then retry.`;
}

export function getWrapperPath(binaryName: string): string {
	return path.join(BIN_DIR, binaryName);
}

export interface BuildWrapperScriptOptions {
	/**
	 * `BuiltinAgentId` for the wrapped binary (e.g. "claude", "codex"). When
	 * set, the wrapper exports `SUPERSET_AGENT_ID` so the agent process and
	 * any hook subprocess it spawns inherit the wrapper-level identity. The
	 * notify-hook script forwards this into the v2 hook payload.
	 */
	agentId?: string;
}

export function buildWrapperScript(
	binaryName: string,
	execLine: string,
	options: BuildWrapperScriptOptions = {},
): string {
	const exportAgentId = options.agentId
		? `export SUPERSET_AGENT_ID="${options.agentId}"\n\n`
		: "";
	return `#!/bin/bash
${WRAPPER_MARKER}
# Superset wrapper for ${binaryName}

# Our own path, for the self-check in find_real_binary. BASH_SOURCE rather than
# $0 because the .cmd shim invokes us by an absolute path that $0 does not
# always carry intact.
SUPERSET_WRAPPER_SELF="\${BASH_SOURCE[0]}"

# A backstop, not the fix. If the self-check above ever misses, this turns an
# unbounded fork into one legible error — the failure it replaces filled the
# process table and printed "shell level (1000) too high".
SUPERSET_WRAPPER_DEPTH="\${SUPERSET_WRAPPER_DEPTH:-0}"
if [ "$SUPERSET_WRAPPER_DEPTH" -ge 3 ]; then
  echo "Superset: the ${binaryName} wrapper resolved to itself. Check that ${binaryName} is installed outside $SUPERSET_HOME_DIR/bin." >&2
  exit 127
fi
export SUPERSET_WRAPPER_DEPTH=$((SUPERSET_WRAPPER_DEPTH + 1))

${buildRealBinaryResolver()}
REAL_BIN="$(find_real_binary "${binaryName}")"
if [ -z "$REAL_BIN" ]; then
  echo "${getMissingBinaryMessage(binaryName)}" >&2
  exit 127
fi

${exportAgentId}${execLine}
`;
}

/**
 * The Windows half of a wrapper: a `.cmd` that runs the bash one.
 *
 * The wrapper itself is a `#!/bin/bash` script with NO FILE EXTENSION, and
 * Windows cannot execute one of those. It does not fail either — it hands the
 * file to the shell, and the user gets the "Select an app to open 'codex'"
 * picker offering Notepad and Visual Studio. `BIN_DIR` is on PATH, so this
 * happens for whichever agent the wrapper wins the PATH race for.
 *
 * It stayed hidden on this machine because an npm-installed `codex.cmd` in
 * `AppData\Roaming\npm` resolved ahead of the wrapper. Anyone WITHOUT that npm
 * shim — a fresh install of the public build, for instance — gets the picker
 * instead of their agent. `PATHEXT` is not the problem and adding to it is not
 * the fix; a `.cmd` beside the script is, because `PATHEXT` already contains
 * `.CMD` so `codex` now resolves to `codex.cmd` and runs.
 *
 * The bash path mirrors `getManagedNotifyHookCommand` above, with a fallback to
 * whatever `bash` is on PATH so a non-default Git install still works.
 */
function buildWindowsCmdShim(binaryName: string): string {
	return [
		"@echo off",
		`rem ${WRAPPER_MARKER}`,
		`rem Windows shim for the ${binaryName} wrapper beside this file.`,
		"setlocal",
		'set "SUPERSET_BASH=C:\\Program Files\\Git\\bin\\bash.exe"',
		'if not exist "%SUPERSET_BASH%" set "SUPERSET_BASH=bash"',
		`"%SUPERSET_BASH%" "%~dp0${binaryName}" %*`,
		"exit /b %ERRORLEVEL%",
		"",
	].join("\r\n");
}

export function createWrapper(binaryName: string, script: string): void {
	const changed = writeFileIfChanged(getWrapperPath(binaryName), script, 0o755);
	console.log(
		`[agent-setup] ${changed ? "Updated" : "Verified"} ${binaryName} wrapper`,
	);

	if (process.platform !== "win32") return;
	const cmdChanged = writeFileIfChanged(
		`${getWrapperPath(binaryName)}.cmd`,
		buildWindowsCmdShim(binaryName),
		0o755,
	);
	console.log(
		`[agent-setup] ${cmdChanged ? "Updated" : "Verified"} ${binaryName}.cmd shim`,
	);
}
