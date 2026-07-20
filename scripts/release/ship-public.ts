#!/usr/bin/env bun

// Ship a new public GatedSpace release in one command.
//
//   bun run ship 1.14.3 "session-loss guards"
//
// GatedSpace uses two repos (see the project-gatedspace-repos note):
//   origin  = yzgershon/GatedSpace   — PUBLIC, snapshot commits only
//   archive = yzgershon/gatedspace-dev — private, full windows-port history
//
// So a release is not just "tag HEAD": the public repo must receive a single
// squashed snapshot commit chained onto the previous public commit, and the
// release tag must point at THAT commit — never at a dev-branch commit, which
// would republish upstream Superset's history on the public repo.
//
// This script does the whole dance:
//   1. bump desktop + host-service + cli (optionally pty-daemon) on the dev
//      branch, commit, push to archive
//   2. commit-tree the dev branch's tree onto public main → snapshot commit
//   3. push snapshot to origin/main, tag desktop-v<version> at the snapshot
//   4. watch the release workflow, then publish the draft release
//
// Publishing flips the switch for every user: their app's 4-hourly check sees
// the new latest.yml, downloads in the background, and the sidebar shows the
// green "↑ update" pill. Nobody reinstalls by hand.
//
// Flags: --dry-run (print the plan, touch nothing), --no-publish (leave the
// release as a draft), --daemon (also patch-bump pty-daemon).

import { existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import {
	bumpDaemonPatch,
	fail,
	findWorkflowRun,
	info,
	readVersion,
	refreshLockfile,
	repoRoot,
	sleep,
	success,
	syncUnified,
	warn,
	writeVersion,
} from "./lib.ts";

const DESKTOP_DIR = "apps/desktop";
const PUBLIC_REMOTE = "origin";
const ARCHIVE_REMOTE = "archive";
const PUBLIC_BRANCH = "main";
const DEV_BRANCH = "windows-port";
const PLAIN = /^\d+\.\d+\.\d+$/;

async function code(p: ReturnType<typeof $>): Promise<number> {
	return (await p.nothrow().quiet()).exitCode;
}

async function text(p: ReturnType<typeof $>): Promise<string> {
	return (await p.nothrow().text()).trim();
}

interface ShipOptions {
	version: string;
	headline: string;
	dryRun: boolean;
	publish: boolean;
	withDaemon: boolean;
}

function parseArgs(argv: string[]): ShipOptions {
	let version = "";
	let headline = "";
	let dryRun = false;
	let publish = true;
	let withDaemon = false;
	for (const arg of argv) {
		if (arg === "--dry-run") dryRun = true;
		else if (arg === "--no-publish") publish = false;
		else if (arg === "--daemon") withDaemon = true;
		else if (arg.startsWith("-"))
			fail(
				`Unknown option: ${arg}\nUsage: bun run ship <version> ["headline"] [--dry-run] [--no-publish] [--daemon]`,
			);
		else if (!version) version = arg;
		else if (!headline) headline = arg;
		else fail(`Unexpected argument: ${arg}`);
	}
	if (!version) {
		fail(
			`Usage: bun run ship <version> ["headline"] [--dry-run] [--no-publish] [--daemon]`,
		);
	}
	if (!PLAIN.test(version)) {
		fail(
			`Invalid version: ${version}. Expected MAJOR.MINOR.PATCH (e.g. 1.14.3).`,
		);
	}
	return { version, headline, dryRun, publish, withDaemon };
}

/**
 * Refuse to run unless the repo is in the exact shape this flow assumes —
 * pushing the wrong ref to a public repo is not something you can take back.
 */
async function preflight(root: string, tag: string): Promise<void> {
	if (!Bun.which("gh")) fail("GitHub CLI (gh) is required but not installed.");
	if ((await code($`gh auth status`)) !== 0) {
		fail("Not authenticated with GitHub CLI. Run: gh auth login");
	}
	if (!existsSync(join(root, DESKTOP_DIR))) {
		fail("Run this from the monorepo root (apps/desktop not found).");
	}

	const branch = await text($`git branch --show-current`);
	if (branch !== DEV_BRANCH) {
		fail(`Expected to be on '${DEV_BRANCH}', but you're on '${branch}'.`);
	}

	const dirty = await text($`git status --porcelain --untracked-files=no`);
	if (dirty) {
		fail(
			"Working tree has uncommitted changes. Commit or stash them first:\n" +
				dirty,
		);
	}

	const publicUrl = await text($`git remote get-url ${PUBLIC_REMOTE}`);
	if (!/GatedSpace(\.git)?$/i.test(publicUrl)) {
		fail(
			`Remote '${PUBLIC_REMOTE}' should be the public GatedSpace repo, got: ${publicUrl}`,
		);
	}
	if ((await code($`git remote get-url ${ARCHIVE_REMOTE}`)) !== 0) {
		fail(`Remote '${ARCHIVE_REMOTE}' (private dev mirror) is not configured.`);
	}

	await $`git fetch ${PUBLIC_REMOTE} ${PUBLIC_BRANCH}`.nothrow().quiet();

	// The PUBLIC remote is the only authority on "has this version shipped?".
	// Upstream Superset's own desktop-v* tags ride along with any
	// `git fetch upstream --tags`, so a local tag of the same name usually
	// means "upstream released that number", not "we did".
	const remoteTag = await text(
		$`git ls-remote --tags ${PUBLIC_REMOTE} ${`refs/tags/${tag}`}`,
	);
	if (remoteTag) {
		fail(`${tag} is already published on the public repo. Pick a new version.`);
	}
}

/**
 * True when a local tag of this name exists but belongs to someone else
 * (upstream). We then push the release tag to the public repo by SHA rather
 * than creating a conflicting local tag.
 */
async function hasForeignLocalTag(tag: string): Promise<boolean> {
	return (
		(await code($`git rev-parse --verify --quiet ${`refs/tags/${tag}`}`)) === 0
	);
}

async function bumpVersions(
	root: string,
	opts: ShipOptions,
): Promise<string | null> {
	const current = readVersion(root, DESKTOP_DIR);
	if (current === opts.version) {
		warn(`apps/desktop is already at ${opts.version}; skipping version bump.`);
		return null;
	}

	info(`Bumping ${current} → ${opts.version} (desktop, host-service, cli)…`);
	if (opts.dryRun) return `${current} → ${opts.version}`;

	await writeVersion(root, DESKTOP_DIR, opts.version);
	await syncUnified(root, opts.version);
	const daemonPaths: string[] = [];
	let daemonNote = "";
	if (opts.withDaemon) {
		const { old, next } = await bumpDaemonPatch(root);
		daemonNote = `, pty-daemon ${old} → ${next}`;
		daemonPaths.push("packages/pty-daemon/package.json");
	}
	await refreshLockfile(root);

	await $`git add ${`${DESKTOP_DIR}/package.json`} packages/host-service/package.json packages/cli/package.json ${daemonPaths} bun.lock`;
	await $`git commit -m ${`chore(desktop): bump version to ${opts.version}${daemonNote}`}`;
	success(`Committed version bump${daemonNote}`);
	return `${current} → ${opts.version}${daemonNote}`;
}

/**
 * Squash the dev branch's current tree into ONE commit chained onto public
 * main. commit-tree (not merge/rebase) is what keeps the public history a
 * tidy release log instead of 3,000 upstream commits.
 */
async function createSnapshot(opts: ShipOptions): Promise<string> {
	const tree = await text($`git rev-parse ${`${DEV_BRANCH}^{tree}`}`);
	const parent = await text(
		$`git rev-parse ${`${PUBLIC_REMOTE}/${PUBLIC_BRANCH}`}`,
	);
	const parentTree = await text($`git rev-parse ${`${parent}^{tree}`}`);
	if (tree === parentTree) {
		fail(
			"Nothing to ship: the dev branch tree is identical to public main. Commit changes first.",
		);
	}

	const headline = opts.headline || "maintenance release";
	const message = `GatedSpace ${opts.version} — ${headline}\n`;
	if (opts.dryRun) {
		info(
			`Would create snapshot commit on ${parent.slice(0, 9)}: ${message.trim()}`,
		);
		return "DRY-RUN-SNAPSHOT";
	}

	const msgFile = join(tmpdir(), `gatedspace-ship-${opts.version}.txt`);
	writeFileSync(msgFile, message, "utf8");
	try {
		const sha = await text(
			$`git commit-tree ${tree} -p ${parent} -F ${msgFile}`,
		);
		if (!sha) fail("git commit-tree produced no commit.");
		success(`Snapshot commit ${sha.slice(0, 9)} created on public main`);
		return sha;
	} finally {
		rmSync(msgFile, { force: true });
	}
}

async function publishRelease(
	root: string,
	tag: string,
	snapshot: string,
	opts: ShipOptions,
): Promise<void> {
	const sha = snapshot;
	info("Waiting for the release workflow…");
	const runId = await findWorkflowRun(root, "release-desktop.yml", sha);
	if (!runId) {
		warn("Could not find the workflow run — check the Actions tab.");
	} else {
		console.log(
			`  https://github.com/yzgershon/GatedSpace/actions/runs/${runId}`,
		);
		await $`gh run watch ${runId}`.nothrow();
		const conclusion = await text(
			$`gh run view ${runId} --json conclusion --jq ${".conclusion"}`,
		);
		if (conclusion !== "success") {
			fail(
				`Release workflow ${conclusion || "did not succeed"} — nothing published.`,
			);
		}
		success("Installers built for x64 and arm64");
	}

	// The workflow creates the release as a draft; a draft serves no update
	// manifest, so users only see the update once it is published.
	let found = false;
	for (let i = 0; i < 10 && !found; i++) {
		await sleep(3000);
		found = (await code($`gh release view ${tag}`)) === 0;
	}
	if (!found) {
		warn(`Draft release not visible yet — check the Releases tab for ${tag}.`);
		return;
	}

	if (!opts.publish) {
		success(`Draft release ${tag} created (not published).`);
		console.log(`Publish when ready: gh release edit ${tag} --draft=false`);
		return;
	}

	await $`gh release edit ${tag} --draft=false`;
	success(`Published ${tag} — every installed app will offer this update.`);
}

export async function runShip(argv: string[]): Promise<void> {
	const opts = parseArgs(argv);
	const tag = `desktop-v${opts.version}`;
	const root = await repoRoot();
	process.chdir(root);

	await preflight(root, tag);
	if (opts.dryRun)
		warn("DRY RUN — no commits, pushes, or releases will happen.");

	await bumpVersions(root, opts);

	if (!opts.dryRun) {
		info(`Pushing ${DEV_BRANCH} to ${ARCHIVE_REMOTE} (private history)…`);
		await $`git push ${ARCHIVE_REMOTE} ${DEV_BRANCH}`;
		success("Dev branch archived");
	}

	const snapshot = await createSnapshot(opts);

	if (opts.dryRun) {
		info(
			`Would push snapshot to ${PUBLIC_REMOTE}/${PUBLIC_BRANCH} and tag ${tag}`,
		);
		info(
			opts.publish
				? "Would watch the build, then publish the release."
				: "Would watch the build and leave the release as a draft.",
		);
		success("Dry run complete — nothing was changed.");
		return;
	}

	info(`Pushing snapshot to ${PUBLIC_REMOTE}/${PUBLIC_BRANCH}…`);
	await $`git push ${PUBLIC_REMOTE} ${`${snapshot}:refs/heads/${PUBLIC_BRANCH}`}`;

	if (await hasForeignLocalTag(tag)) {
		// Upstream owns this tag name locally; push ours straight to the public
		// remote by SHA so the release still triggers, without clobbering it.
		warn(
			`Local tag ${tag} belongs to upstream — pushing the release tag by SHA.`,
		);
		await $`git push ${PUBLIC_REMOTE} ${`${snapshot}:refs/tags/${tag}`}`;
	} else {
		await $`git tag ${tag} ${snapshot}`;
		await $`git push ${PUBLIC_REMOTE} ${tag}`;
	}
	success(`Tagged ${tag} on the public snapshot`);

	await publishRelease(root, tag, snapshot, opts);
}

if (import.meta.main) await runShip(process.argv.slice(2));
