#!/usr/bin/env bash
# Launcher for GatedSpace Dev.
#
# Logs from the FIRST line to $LAUNCH_LOG. The window is minimised, so without
# this a failure before `bun` even starts is completely invisible — which is
# exactly how "it doesn't even open" looks from the outside.
#
# Runs under Git Bash, NOT cmd.exe, and that is not a style preference. The
# identical `bun run dev` renders correctly when its parent is bash and paints a
# black window when its parent is cmd.exe — bisected repeatedly, with identical
# environments and the same Vite serving 200s on 3005 in both cases. The cause
# is still unknown. Until it is found, this uses the parent that is known to
# work.
set -u

DESKTOP_DIR="/c/Dev/superset/apps/desktop"
LAUNCH_LOG="$DESKTOP_DIR/dev-launcher.log"
LOG="$DESKTOP_DIR/dev-instance.log"

# Truncate and start recording immediately.
{
	echo "=== GatedSpace Dev launcher ==="
	echo "when : $(date '+%Y-%m-%d %H:%M:%S')"
	echo "shell: ${BASH_VERSION:-unknown}"
	echo "pwd  : $(pwd)"
} >"$LAUNCH_LOG" 2>&1

exec >>"$LAUNCH_LOG" 2>&1

cd "$DESKTOP_DIR" || { echo "FATAL: cannot cd to $DESKTOP_DIR"; exit 1; }

# Explorer launches with the user's PATH, which is not necessarily the PATH a
# terminal has. Resolve bun explicitly and say so if it is missing, rather than
# dying with a bare "command not found" nobody will ever read.
BUN="$(command -v bun || true)"
if [ -z "$BUN" ]; then
	for candidate in \
		"/c/Users/$USERNAME/AppData/Local/Microsoft/WinGet/Packages/Oven-sh.Bun_Microsoft.Winget.Source_8wekyb3d8bbwe/bun-windows-aarch64/bun.exe" \
		"/c/Users/$USERNAME/.bun/bin/bun.exe"; do
		[ -x "$candidate" ] && BUN="$candidate" && break
	done
fi
if [ -z "$BUN" ]; then
	echo "FATAL: bun not found on PATH and not at the known install locations."
	echo "PATH=$PATH"
	exit 1
fi
echo "bun  : $BUN"

# Only electron.exe and the dev server. GatedSpace.exe is the INSTALLED app and
# is never touched — killing that would take down real work.
#
# This cleanup is the whole reason the launcher exists: killing the dev Electron
# without stopping electron-vite leaves a bare electron.exe behind, and starting
# that gives the "electron.exe path-to-app" Electron welcome screen, which looks
# exactly like the app is broken.
cleanup() {
	powershell -NoProfile -Command \
		"Get-Process -Name electron -ErrorAction SilentlyContinue | Stop-Process -Force; \
		 Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | \
		   Where-Object { \$_.CommandLine -like '*electron-vite*' } | \
		   ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }" \
		>/dev/null 2>&1 || true
}

echo ""
echo "  GatedSpace Dev is starting."
echo "  This takes about 20-45 seconds the first time. The window appears"
echo "  on its own. Leave this console open; closing it stops the app."
echo ""
# Opens on the dashboard by default.
#
# This used to hardcode a workspace id so dev would land straight on panes.
# That id did not resolve: the router silently dropped it, fell back to bare
# /v2-workspace, which has no page, and rendered BLACK on every launch. The
# dashboard always resolves, so it is the safe default — click into whatever
# workspace you want from there.
#
# To pin a screen while iterating, set a route here. No leading slash: Git Bash
# rewrites a value starting with "/" into a Windows path before it reaches the
# exe. Verify the id resolves before leaving it set.
#   export GATEDSPACE_DEV_ROUTE="v2-workspace/<id>"

echo "cleaning up any previous instance..."
cleanup

echo "starting: $BUN run dev  (app log: $LOG)"
"$BUN" run dev >"$LOG" 2>&1
echo "bun run dev exited with $?"

cleanup
echo "done"
