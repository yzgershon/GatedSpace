import { Code2, FileCode2, ListFilter, RefreshCw } from "lucide-react";
import {
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {
	getCodexSession,
	subscribeCodexSession,
} from "renderer/lib/codex-session/store";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import {
	getSessionCwd,
	getSessionSnapshot,
	subscribeSession,
} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ClaudeSessionPane/sessionStore";
import { LiveCodeSurface } from "./LiveCodeSurface";
import {
	absoluteCodePath,
	claudeLiveFiles,
	codexLiveFiles,
} from "./live-code-files";

export default function LiveCodePanel({
	paneId,
	workspaceId,
	provider,
	cwd: fallbackCwd,
}: {
	paneId: string;
	workspaceId: string;
	provider: "claude" | "codex";
	cwd?: string;
}) {
	const codex = useSyncExternalStore(
		(fn) =>
			provider === "codex" ? subscribeCodexSession(paneId, fn) : () => {},
		() => (provider === "codex" ? getCodexSession(paneId) : undefined),
	);
	const claude = useSyncExternalStore(
		(fn) => (provider === "claude" ? subscribeSession(paneId, fn) : () => {}),
		() => (provider === "claude" ? getSessionSnapshot(paneId) : undefined),
	);
	const files = useMemo(
		() =>
			provider === "codex"
				? codexLiveFiles(codex)
				: claudeLiveFiles(claude?.timeline.items ?? []),
		[provider, codex, claude],
	);
	const cwd =
		codex?.cwd ||
		(provider === "claude" && getSessionCwd(paneId)) ||
		fallbackCwd ||
		"";
	const initialPaths = useRef(new Set(files.map((file) => file.path)));
	const [chosen, setChosen] = useState<string>();
	const [follow, setFollow] = useState(true);
	const [diff, setDiff] = useState(false);
	const [refresh, setRefresh] = useState(0);
	const selected =
		(follow ? files.at(-1) : files.find((file) => file.path === chosen)) ??
		files.at(-1);
	const path = selected && cwd ? absoluteCodePath(cwd, selected.path) : "";
	const [content, setContent] = useState<{
		path: string;
		text: string;
		error?: string;
		version?: string;
	}>({ path: "", text: "" });
	const baselines = useRef(new Map<string, string>());
	const [baseline, setBaseline] = useState("");
	const revision = selected?.revision;
	const deleted = selected?.deleted;
	const version = `${revision ?? ""}:${refresh}`;
	useEffect(() => {
		if (!path) return;
		let disposed = false,
			pending = false,
			again = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const load = async () => {
			if (disposed || document.hidden) return;
			if (pending) {
				again = true;
				return;
			}
			pending = true;
			try {
				if (deleted) throw new Error("This file was deleted by the session.");
				const result = await electronTrpcClient.filesystem.readFile.query({
					workspaceId,
					absolutePath: path,
					encoding: "utf-8",
					maxBytes: 512 * 1024,
				});
				if (disposed) return;
				if (result.exceededLimit)
					throw new Error(
						"This file exceeds the 512 KB live preview limit. Open it in the file editor instead.",
					);
				if (
					result.kind !== "text" ||
					typeof result.content !== "string" ||
					result.content.includes("\0")
				)
					throw new Error(
						"This file is not text and cannot be shown as live code.",
					);
				if (!baselines.current.has(path))
					baselines.current.set(path, result.content);
				setBaseline(baselines.current.get(path) ?? "");
				setContent((old) =>
					old.path === path &&
					old.text === result.content &&
					old.version === version &&
					!old.error
						? old
						: { path, text: result.content, version },
				);
			} catch (error) {
				if (!disposed)
					setContent({
						path,
						text: "",
						error:
							error instanceof Error
								? error.message
								: "Could not read this file.",
					});
			} finally {
				pending = false;
				if (again && !disposed) {
					again = false;
					void load();
				}
			}
		};
		const schedule = () => {
			clearTimeout(timer);
			timer = setTimeout(() => void load(), 90);
		};
		void load();
		// Watch only this file's directory, non-recursively, to survive atomic saves.
		// No workspace scan, git command, polling loop, or agent request is involved.
		const subscription = electronTrpcClient.filesystem.watchPath.subscribe(
			{
				workspaceId,
				absolutePath: path.slice(0, path.lastIndexOf("/")),
				recursive: false,
			},
			{
				onData: (batch) => {
					if (
						batch.events.some((event) =>
							[event.absolutePath, event.oldAbsolutePath].some(
								(value) =>
									value?.replaceAll("\\", "/").toLowerCase() ===
									path.toLowerCase(),
							),
						)
					)
						schedule();
				},
				onError: () => {}, // Provider edit events and Refresh still update the view.
			},
		);
		const visible = () => {
			if (!document.hidden) schedule();
		};
		document.addEventListener("visibilitychange", visible);
		return () => {
			disposed = true;
			clearTimeout(timer);
			subscription.unsubscribe();
			document.removeEventListener("visibilitychange", visible);
		};
	}, [workspaceId, path, deleted, version]);
	const loaded = content.path === path;
	return (
		<section className="gs-live-editor" aria-label="Live code editor">
			<header>
				<Code2 size={16} />
				<strong>Live code</strong>
				<button
					type="button"
					aria-pressed={follow}
					onClick={() => setFollow(!follow)}
				>
					<ListFilter size={13} />
					{follow ? "Following agent" : "Follow changes"}
				</button>
			</header>
			{files.length ? (
				<>
					<nav
						className="gs-live-file-tabs"
						aria-label="Files edited this turn"
					>
						{files.map((file) => (
							<button
								type="button"
								key={file.path}
								aria-current={selected?.path === file.path ? "page" : undefined}
								title={file.path}
								onClick={() => {
									setChosen(file.path);
									setFollow(false);
								}}
							>
								<FileCode2 size={14} />
								<span>{file.path.split(/[\\/]/).at(-1)}</span>
							</button>
						))}
					</nav>
					<div className="gs-live-breadcrumb">
						<span title={path}>{selected?.path}</span>
						<div>
							<button
								type="button"
								aria-pressed={!diff}
								onClick={() => setDiff(false)}
							>
								Code
							</button>
							<button
								type="button"
								aria-pressed={diff}
								onClick={() => setDiff(true)}
							>
								Diff
							</button>
						</div>
						<button
							type="button"
							aria-label="Refresh live file"
							title="Refresh live file"
							onClick={() => setRefresh((value) => value + 1)}
						>
							<RefreshCw size={13} />
						</button>
					</div>
					{!loaded ? (
						<p className="gs-live-empty">Reading file…</p>
					) : content.error ? (
						<output className="gs-live-empty select-text cursor-text">
							{content.error}
						</output>
					) : (
						<div className="gs-live-code-views" data-diff={diff}>
							{diff && (
								<section>
									<span>When first opened</span>
									<LiveCodeSurface
										path={path}
										code={baseline}
										animate={false}
										follow={false}
									/>
								</section>
							)}
							<section>
								{diff && <span>Current file</span>}
								<LiveCodeSurface
									key={path}
									path={path}
									code={content.text}
									animate
									animateInitial={
										follow && !initialPaths.current.has(selected?.path ?? "")
									}
									follow={follow}
								/>
							</section>
						</div>
					)}
				</>
			) : (
				<div className="gs-live-empty">
					<FileCode2 size={28} />
					<strong>Ready for the next edit</strong>
					<span>Files reported by this session appear here as it works.</span>
				</div>
			)}
			<footer>
				<span>
					{files.length} {files.length === 1 ? "file" : "files"} this turn
				</span>
				<span>Read only · Live file updates</span>
			</footer>
		</section>
	);
}
