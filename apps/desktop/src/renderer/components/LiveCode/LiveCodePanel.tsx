import {
	AlertCircle,
	ArrowDownToLine,
	Check,
	Code2,
	FileCode2,
	RefreshCw,
	WrapText,
} from "lucide-react";
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
import { FileIcon } from "renderer/lib/fileIcons/FileIcon";
import {
	getSessionCwd,
	getSessionSnapshot,
	subscribeSession,
} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/ClaudeSessionPane/sessionStore";
import { detectLanguage } from "shared/detect-language";
import { LiveCodeSurface } from "./LiveCodeSurface";
import {
	absoluteCodePath,
	claudeLiveFiles,
	codePathKey,
	codexLiveFiles,
	snapshotPatch,
} from "./live-code-files";
import { useLiveFile } from "./use-live-file";

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
	const cwd =
		codex?.cwd ||
		(provider === "claude" && getSessionCwd(paneId)) ||
		fallbackCwd ||
		"";
	const files = useMemo(
		() =>
			provider === "codex"
				? codexLiveFiles(codex)
				: claudeLiveFiles(claude?.timeline.items ?? [], cwd),
		[provider, codex, claude, cwd],
	);
	const initialPaths = useRef(
		new Set(files.map((file) => codePathKey(cwd, file.path))),
	);
	const [chosen, setChosen] = useState<string>();
	const [follow, setFollow] = useState(true);
	const [diff, setDiff] = useState(false);
	const [wrap, setWrap] = useState(false);
	const [refresh, setRefresh] = useState(0);
	const tabs = useRef<HTMLDivElement>(null);
	const selected =
		(follow
			? files.at(-1)
			: files.find((file) => codePathKey(cwd, file.path) === chosen)) ??
		files.at(-1);
	const path = selected ? absoluteCodePath(cwd, selected.path) : "";
	const content = useLiveFile({
		paneId,
		workspaceId,
		provider,
		path,
		revision: selected?.revision,
		deleted: selected?.deleted,
		refresh,
	});
	const patch =
		selected?.patch ||
		(content.loaded ? snapshotPatch(content.baseline, content.text) : "");
	const refreshFile = () => setRefresh((value) => value + 1);
	useEffect(() => {
		if (path)
			tabs.current
				?.querySelector('[aria-selected="true"]')
				?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [path]);
	const basename = path.split("/").at(-1) ?? "";
	return (
		<section className="gs-live-editor" aria-label="Live code editor">
			<header className="gs-live-toolbar">
				<Code2 size={16} />
				<strong>Live code</strong>
				<div className="gs-live-toolbar-actions">
					<button
						type="button"
						className="gs-live-follow"
						aria-pressed={follow}
						onClick={() => setFollow(!follow)}
						title="Automatically show the latest edited file and follow its changes"
					>
						<ArrowDownToLine size={13} />
						<span>{follow ? "Following" : "Follow agent"}</span>
					</button>
					<div className="gs-live-mode">
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
						className="gs-live-icon-button"
						aria-label="Wrap lines"
						title="Wrap lines"
						aria-pressed={wrap}
						onClick={() => setWrap(!wrap)}
					>
						<WrapText size={15} />
					</button>
					<button
						type="button"
						className="gs-live-icon-button"
						aria-label="Refresh live file"
						title="Refresh live file"
						onClick={refreshFile}
					>
						<RefreshCw size={14} />
					</button>
				</div>
			</header>
			{files.length ? (
				<>
					<div
						ref={tabs}
						className="gs-live-file-tabs"
						aria-label="Edited files"
						role="tablist"
					>
						{files.map((file) => (
							<button
								type="button"
								role="tab"
								key={codePathKey(cwd, file.path)}
								aria-selected={selected === file}
								tabIndex={selected === file ? 0 : -1}
								onKeyDown={(event) => {
									const buttons = Array.from(
										tabs.current?.querySelectorAll<HTMLButtonElement>(
											'[role="tab"]',
										) ?? [],
									);
									const index = buttons.indexOf(event.currentTarget);
									const next =
										event.key === "Home"
											? 0
											: event.key === "End"
												? buttons.length - 1
												: event.key === "ArrowRight"
													? (index + 1) % buttons.length
													: event.key === "ArrowLeft"
														? (index - 1 + buttons.length) % buttons.length
														: -1;
									if (next < 0) return;
									event.preventDefault();
									buttons[next]?.focus();
									buttons[next]?.click();
								}}
								title={absoluteCodePath(cwd, file.path)}
								onClick={() => {
									setChosen(codePathKey(cwd, file.path));
									setFollow(false);
								}}
							>
								<FileIcon
									fileName={file.path.split(/[\\/]/).at(-1) ?? file.path}
								/>
								<span>{file.path.split(/[\\/]/).at(-1)}</span>
								{file.deleted && <span className="gs-live-deleted">D</span>}
							</button>
						))}
					</div>
					<div className="gs-live-breadcrumb">
						<span title={path}>
							{path.slice(0, -basename.length)}
							<b>{basename}</b>
						</span>
						<span className="gs-live-readonly">
							{diff
								? selected?.patch
									? "Latest changes"
									: "Since opening"
								: "Read only"}
						</span>
					</div>
					{(content.error || content.watchError) && (
						<output className="gs-live-notice">
							<AlertCircle size={14} />
							<span className="select-text cursor-text">
								{content.error ||
									"Live updates disconnected. Showing the last saved snapshot."}
							</span>
							<button type="button" onClick={refreshFile}>
								Retry
							</button>
						</output>
					)}
					{content.loaded && !selected?.deleted && (
						<div className="gs-live-code-views" hidden={diff}>
							<section>
								<LiveCodeSurface
									key={path}
									path={path}
									code={content.text}
									animate={!diff}
									animateInitial={
										follow &&
										!initialPaths.current.has(
											codePathKey(cwd, selected?.path ?? ""),
										)
									}
									follow={follow && !diff}
									wrap={wrap}
								/>
							</section>
						</div>
					)}
					{diff && patch ? (
						<div className="gs-live-code-views">
							<section>
								<LiveCodeSurface
									key={`${path}:patch`}
									path={path}
									code={patch}
									animate={false}
									follow={false}
									wrap={wrap}
									diff
								/>
							</section>
						</div>
					) : diff ? (
						<div className="gs-live-empty">
							<Check size={26} />
							<strong>No captured changes yet</strong>
							<span>Changes will appear here after the next edit.</span>
						</div>
					) : selected?.deleted ? (
						<div className="gs-live-empty">
							<FileCode2 size={26} />
							<strong>File deleted</strong>
							<span>Switch to Diff to inspect its reported changes.</span>
						</div>
					) : !content.loaded ? (
						<div className="gs-live-empty">
							<FileCode2 size={26} />
							<strong>
								{content.error ? "File unavailable" : "Reading file…"}
							</strong>
							<span>
								{content.error
									? "Retry to reconnect, or choose another file above."
									: "Opening the session’s saved file."}
							</span>
						</div>
					) : null}
				</>
			) : (
				<div className="gs-live-empty">
					<div className="gs-live-empty-icon">
						<Code2 size={26} />
					</div>
					<strong>Ready for the next edit</strong>
					<span>
						As {provider === "codex" ? "Codex" : "Claude"} changes files, watch
						the code take shape here.
					</span>
				</div>
			)}
			<footer>
				<span>
					{files.length} {files.length === 1 ? "file" : "files"}
					<span className="gs-live-footer-divider" />
					{content.loaded && !diff
						? `${content.text.split("\n").length} lines`
						: diff
							? "Changes"
							: "Live code"}
				</span>
				<span>
					{path && detectLanguage(path)}
					<span className="gs-live-footer-divider" />
					{content.watchError ? "Updates paused" : "Read only"}
				</span>
			</footer>
		</section>
	);
}
