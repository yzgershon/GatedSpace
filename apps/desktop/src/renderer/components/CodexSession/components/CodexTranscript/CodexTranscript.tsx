import { ArrowDown, ChevronRight, FileDiff } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { SessionWelcome } from "renderer/components/SessionWelcome";
import type { CodexSessionState } from "shared/codex-session/types";
import { CodexApprovalCard } from "../CodexApprovalCard/CodexApprovalCard";
import { transcriptTurns } from "./activity";
import { TranscriptMessage } from "./components/TranscriptMessage/TranscriptMessage";
import { TurnActivity } from "./components/TurnActivity/TurnActivity";
import "./activity.css";

export function CodexTranscript({
	state,
	onEarlier,
	loadingEarlier,
	onSuggest,
	onReviewChanges,
}: {
	state?: CodexSessionState;
	onEarlier: () => void;
	loadingEarlier: boolean;
	onSuggest: (value: string) => void;
	onReviewChanges?: () => void;
}) {
	const scroll = useRef<HTMLElement>(null);
	const follow = useRef(true);
	const [showJump, setShowJump] = useState(false);
	const previousHeight = useRef<number | null>(null);
	const content = useRef<HTMLDivElement>(null);
	const turns = transcriptTurns(state);
	const items = state?.items ?? [];
	const working = state?.status === "working";
	const empty = !items.length && !working;
	// biome-ignore lint/correctness/useExhaustiveDependencies: each streamed snapshot can change the measured scroll height.
	useLayoutEffect(() => {
		const el = scroll.current;
		if (!el) return;
		if (previousHeight.current !== null && !loadingEarlier) {
			el.scrollTop += el.scrollHeight - previousHeight.current;
			previousHeight.current = null;
		} else if (follow.current) el.scrollTop = el.scrollHeight;
	}, [state, loadingEarlier]);
	useLayoutEffect(() => {
		const el = scroll.current;
		if (!el || !content.current) return;
		const observer = new ResizeObserver(() => {
			if (follow.current && previousHeight.current === null)
				el.scrollTop = el.scrollHeight;
		});
		observer.observe(content.current);
		return () => observer.disconnect();
	}, []);
	return (
		<div className="codex-transcript-wrap">
			<section
				className="codex-transcript-scroll"
				aria-label="Codex transcript"
				// biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users must be able to scroll and review the transcript.
				tabIndex={0}
				ref={scroll}
				onWheel={(event) => {
					if (event.deltaY < 0) follow.current = false;
				}}
				onPointerDown={(event) => {
					if (event.target === event.currentTarget) follow.current = false;
				}}
				onTouchStart={() => {
					follow.current = false;
				}}
				onKeyDown={(event) => {
					if (["PageUp", "Home", "ArrowUp"].includes(event.key))
						follow.current = false;
				}}
				onClickCapture={(event) => {
					if (
						(event.target as HTMLElement).closest(
							".codex-action-trigger, .codex-group-heading, .codex-work-heading",
						)
					)
						follow.current = false;
				}}
				onScroll={() => {
					const el = scroll.current;
					if (!el) return;
					if (el.scrollHeight - el.scrollTop - el.clientHeight < 20)
						follow.current = true;
					setShowJump(!follow.current);
				}}
			>
				<div
					ref={content}
					className={`codex-transcript ${empty ? "codex-transcript-empty" : ""}`}
				>
					{state?.historyCursor && (
						<button
							type="button"
							className="codex-earlier"
							disabled={loadingEarlier}
							onClick={() => {
								previousHeight.current = scroll.current?.scrollHeight ?? null;
								onEarlier();
							}}
						>
							{loadingEarlier
								? "Loading earlier messages…"
								: "Load earlier messages"}
						</button>
					)}
					{empty && (
						<SessionWelcome
							provider="codex"
							onSuggest={onSuggest}
							connecting={state?.status === "loading" || !state}
						/>
					)}
					{turns.map((turn) => (
						<div className="codex-turn" key={turn.id}>
							{turn.users.map((item) => (
								<TranscriptMessage key={item.id} item={item} />
							))}
							{(turn.work.length > 0 ||
								turn.active ||
								turn.timing?.durationMs !== undefined) && (
								<TurnActivity
									turn={turn}
									waiting={turn.active && Boolean(state?.approvals.length)}
								/>
							)}
							{turn.answers.map((item) => (
								<TranscriptMessage key={item.id} item={item} />
							))}
						</div>
					))}
					{state?.diff && (
						<details className="codex-changes">
							<summary>
								<FileDiff size={17} />
								Review changes
								<ChevronRight size={14} />
							</summary>
							<pre>{state.diff}</pre>
							{onReviewChanges && (
								<button
									type="button"
									className="codex-load-earlier"
									onClick={onReviewChanges}
								>
									Open workspace changes →
								</button>
							)}
						</details>
					)}
					{state?.approvals.map((approval) => (
						<CodexApprovalCard
							key={approval.id}
							sessionKey={state.key}
							approval={approval}
						/>
					))}
				</div>
			</section>
			{showJump && (
				<button
					type="button"
					className="codex-jump"
					aria-label="Jump to latest message"
					onClick={() => {
						follow.current = true;
						scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
					}}
				>
					<ArrowDown size={16} />
				</button>
			)}
		</div>
	);
}
