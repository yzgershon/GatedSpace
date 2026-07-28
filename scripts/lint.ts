#!/usr/bin/env bun
/**
 * Cross-platform lint entry point.
 *
 * This used to be `./scripts/lint.sh` in package.json, which meant the repo's
 * own lint gate could not run on Windows at all — the primary development
 * platform for this fork. Two separate reasons:
 *
 *   - bun can't exec a `.sh` shebang on Windows, so `bun run lint` died with
 *     "command not found: ./scripts/lint.sh".
 *   - Routing it through `bash` doesn't help either: on Windows `bash` resolves
 *     to the WSL shim, which fails with `execvpe(/bin/bash)` when no distro is
 *     installed. Git Bash is a different binary at a different path.
 *
 * Biome is the part that actually gates the build, and it runs everywhere, so
 * it runs unconditionally here. The auxiliary shell checks still need a POSIX
 * shell; when one isn't available they are SKIPPED LOUDLY rather than silently
 * dropped, because a lint gate that quietly stops checking things is worse than
 * one that admits what it didn't do. CI runs on Linux, where all of them run.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const BIOME = "@biomejs/biome@2.4.2";

/** Shell checks that still live as .sh, in the order lint.sh ran them. */
const SHELL_CHECKS = [
	"./scripts/check-desktop-git-env.sh",
	"./scripts/check-git-ref-strings.sh",
	"./scripts/check-cloud-workspace-usage.sh",
	"./scripts/check-simple-git-usage.sh",
];

/** A POSIX shell that is NOT the WSL relay. Git Bash counts; `bash` may not. */
function findPosixShell(): string | null {
	if (process.platform !== "win32") return "/bin/sh";
	const candidates = [
		"C:\\Program Files\\Git\\bin\\bash.exe",
		"C:\\Program Files (x86)\\Git\\bin\\bash.exe",
		`${process.env.LOCALAPPDATA ?? ""}\\Programs\\Git\\bin\\bash.exe`,
	];
	return candidates.find((p) => p && existsSync(p)) ?? null;
}

let failed = false;

// ── Biome ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const biome = spawnSync("bun", ["x", BIOME, "check", ...args], {
	encoding: "utf8",
	shell: process.platform === "win32",
});
const output = `${biome.stdout ?? ""}${biome.stderr ?? ""}`;
process.stdout.write(output);

// The original wrapper's whole point: biome exits 0 on warnings and infos, and
// this repo treats every diagnostic as a failure.
if (/Found \d+ (error|info|warning)/.test(output) || biome.status !== 0) {
	failed = true;
}

// ── Shell checks ─────────────────────────────────────────────────────
const shell = findPosixShell();
if (shell) {
	for (const script of SHELL_CHECKS) {
		const result = spawnSync(shell, [script], { stdio: "inherit" });
		if (result.status !== 0) failed = true;
	}
} else {
	console.warn(
		`\n[lint] SKIPPED ${SHELL_CHECKS.length} shell checks — no POSIX shell found.\n` +
			`[lint] ${SHELL_CHECKS.join(", ")}\n` +
			`[lint] These run in CI. Install Git for Windows to run them locally.`,
	);
}

process.exit(failed ? 1 : 0);
