import { execFile } from "node:child_process";
import { type FSWatcher, watch } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { HostDb } from "../db/index.ts";
import { workspaces } from "../db/schema.ts";

const execFileAsync = promisify(execFile);

const RESCAN_INTERVAL_MS = 30_000;

/**
 * Debounce window for `.git/` batches: coalesces metadata bursts (commit, fetch
 * ref update, branch switch) that survive the path filter, trading ~1s of refresh
 * latency for fewer idle git subprocesses (#4198). Leading-anchored (see
 * `scheduleFlush`) so a rapid sequence can't starve the flush past this bound.
 */
export const GIT_DIR_DEBOUNCE_MS = 1_000;

/**
 * `.git/` top-level dirs whose churn never changes `git status`: `objects/**`
 * (fetch/gc/repack blobs — the bulk of idle churn), `lfs/**` (object cache),
 * `logs/**` (reflog). A real state change always touches refs/index/HEAD too.
 */
const IGNORED_GIT_DIR_TOP_LEVELS = new Set(["objects", "lfs", "logs"]);

/**
 * `.git/` files whose churn never changes `git status`: `FETCH_HEAD`, rewritten
 * by every fetch (status-affecting ref updates land in `refs/`/`packed-refs`).
 */
const IGNORED_GIT_DIR_FILES = new Set(["FETCH_HEAD"]);

/**
 * Whether a `.git/`-relative path could affect `git status`. Fails open on a
 * null/empty filename so a real change is never dropped.
 */
export function isStatusRelevantGitDirEvent(
	filename: string | null | undefined,
): boolean {
	if (filename == null) return true;
	const normalized = filename.replace(/\\/g, "/");
	if (normalized === "") return true;
	if (IGNORED_GIT_DIR_FILES.has(normalized)) return false;
	const firstSlash = normalized.indexOf("/");
	const topLevel =
		firstSlash === -1 ? normalized : normalized.slice(0, firstSlash);
	return !IGNORED_GIT_DIR_TOP_LEVELS.has(topLevel);
}

export interface GitChangedEvent {
	workspaceId: string;
}

export type GitChangedListener = (event: GitChangedEvent) => void;

interface WatchedWorkspace {
	workspaceId: string;
	worktreePath: string;
	gitDir: string;
	watcher: FSWatcher;
}

/**
 * Watches each workspace's `.git/` directory and emits a coalesced `changed`
 * signal on commits, staging, branch switches, fetches — including from an
 * external terminal. Paths that can't change `git status` (`objects/**`,
 * `lfs/**`, `logs/**`, `FETCH_HEAD`) are filtered via
 * `isStatusRelevantGitDirEvent`. Auto-discovers new workspaces and drops
 * removed ones every 30s (a db read; git only runs for newly seen workspaces).
 *
 * Working-tree file edits are deliberately NOT watched. Every edit used to
 * trigger a full `git status` refresh plus a pull-request branch sync, so any
 * process writing a file every second (logs, heartbeats, dev servers) kept git
 * running nonstop and drained the battery. Clients refetch status on window
 * focus instead; consumers subscribe to `git:changed` for `.git/` activity.
 */
export class GitWatcher {
	private readonly db: HostDb;
	private readonly listeners = new Set<GitChangedListener>();
	private readonly watched = new Map<string, WatchedWorkspace>();
	private readonly debounceTimers = new Map<
		string,
		ReturnType<typeof setTimeout>
	>();
	private rescanTimer: ReturnType<typeof setInterval> | null = null;
	private closed = false;

	constructor(db: HostDb) {
		this.db = db;
	}

	start(): void {
		void this.rescan();
		this.rescanTimer = setInterval(
			() => void this.rescan(),
			RESCAN_INTERVAL_MS,
		);
	}

	onChanged(listener: GitChangedListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	close(): void {
		this.closed = true;
		if (this.rescanTimer) {
			clearInterval(this.rescanTimer);
			this.rescanTimer = null;
		}
		for (const timer of this.debounceTimers.values()) {
			clearTimeout(timer);
		}
		this.debounceTimers.clear();
		for (const entry of this.watched.values()) {
			entry.watcher.close();
		}
		this.watched.clear();
	}

	/**
	 * Handle a raw `.git/` watcher event, scheduling a flush only if it could
	 * affect `git status` (drops `objects/**` fetch/gc/pack churn).
	 */
	private handleGitDirEvent(
		workspaceId: string,
		filename: string | null,
	): void {
		if (!isStatusRelevantGitDirEvent(filename)) return;
		this.scheduleFlush(workspaceId);
	}

	private scheduleFlush(workspaceId: string): void {
		// Leading-anchored: the first event arms the window and later events
		// ride it rather than resetting, so a rapid metadata sequence (rebase,
		// `git am`) can't push the flush past GIT_DIR_DEBOUNCE_MS.
		if (this.debounceTimers.has(workspaceId)) return;
		this.debounceTimers.set(
			workspaceId,
			setTimeout(() => {
				this.debounceTimers.delete(workspaceId);
				const event: GitChangedEvent = { workspaceId };
				for (const listener of this.listeners) {
					// Isolate per-listener throws so one bad subscriber can't skip
					// siblings. Other escapes fall through to the process-level net.
					try {
						listener(event);
					} catch (error) {
						console.error("[git-watcher:listener] threw — contained", {
							error,
						});
					}
				}
			}, GIT_DIR_DEBOUNCE_MS),
		);
	}

	private async rescan(): Promise<void> {
		if (this.closed) return;

		let rows: Array<{ id: string; worktreePath: string }>;
		try {
			rows = this.db
				.select({
					id: workspaces.id,
					worktreePath: workspaces.worktreePath,
				})
				.from(workspaces)
				.all();
		} catch {
			return;
		}

		const currentIds = new Set(rows.map((r) => r.id));

		// Remove watchers for workspaces that no longer exist
		for (const [id, entry] of this.watched) {
			if (!currentIds.has(id)) {
				entry.watcher.close();
				this.watched.delete(id);
			}
		}

		// Add watchers for new workspaces
		for (const row of rows) {
			if (this.watched.has(row.id)) continue;
			await this.watchWorkspace(row.id, row.worktreePath);
		}
	}

	private async watchWorkspace(
		workspaceId: string,
		worktreePath: string,
	): Promise<void> {
		if (this.closed) return;

		let gitDir: string;
		try {
			const { stdout } = await execFileAsync(
				"git",
				["rev-parse", "--git-dir"],
				{ cwd: worktreePath },
			);
			// Relative (`.git`) for a main checkout, absolute for a linked
			// worktree — including Windows drive paths (`C:/…`), which a
			// `startsWith("/")` check misread as relative.
			gitDir = resolve(worktreePath, stdout.trim());
		} catch {
			// Not a git repo or path doesn't exist — skip
			return;
		}

		if (this.closed || this.watched.has(workspaceId)) return;

		let watcher: FSWatcher;
		try {
			watcher = watch(gitDir, { recursive: true }, (_event, filename) => {
				this.handleGitDirEvent(workspaceId, filename);
			});
		} catch {
			// fs.watch failed (e.g. directory doesn't exist)
			return;
		}

		watcher.on("error", () => {
			// Watcher died — clean up so rescan can re-add
			this.watched.delete(workspaceId);
			watcher.close();
		});

		this.watched.set(workspaceId, {
			workspaceId,
			worktreePath,
			gitDir,
			watcher,
		});
	}
}
