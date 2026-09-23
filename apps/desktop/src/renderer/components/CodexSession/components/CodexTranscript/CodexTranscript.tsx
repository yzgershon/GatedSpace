import { ArrowDown } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
	collectPrompts,
	PromptNavigator,
} from "renderer/components/PromptNavigator";
import { SessionWelcome } from "renderer/components/SessionWelcome";
import {
	buildTurnReview,
	type CodexTurnReview,
} from "shared/codex-session/review";
import type { CodexSessionState } from "shared/codex-session/types";
import { CodexApprovalCard } from "../CodexApprovalCard/CodexApprovalCard";
import { transcriptTurns } from "./activity";
import { TranscriptMessage } from "./components/TranscriptMessage/TranscriptMessage";
import { TurnActivity } from "./components/TurnActivity/TurnActivity";
import { TurnChanges } from "./components/TurnChanges";
import { useScrolledPrompt } from "./useScrolledPrompt";
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
	onReviewChanges?: (review: CodexTurnReview) => void;
}) {
	const scroll = useRef<HTMLElement>(null);
	const follow = useRef(true);
	const navigatingUntil = useRef(0);
	const lastUserId = useRef<string | undefined>(undefined);
	const [showJump, setShowJump] = useState(false);
	const previousHeight = useRef<number | null>(null);
	const content = useRef<HTMLDivElement>(null);
	const turns = transcriptTurns(state);
	const items = state?.items ?? [];
	const prompts = useMemo(
		() => collectPrompts(state?.items ?? []),
		[state?.items],
	);
	const loadEarlier = () => {
		follow.current = false;
		previousHeight.current = scroll.current?.scrollHeight ?? null;
		onEarlier();
	};
	const working = state?.status === "working";
	const empty = !items.length && !working;
	useLayoutEffect(() => {
		const el = scroll.current;
		if (!el) return;
		const userId = state?.items.findLast((item) => item.kind === "user")?.id;
		if (userId !== lastUserId.current && userId?.startsWith("local-user-")) {
			follow.current = true;
			navigatingUntil.current = 0;
			previousHeight.current = null;
		}
		lastUserId.current = userId;
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
	const pinned = useScrolledPrompt(scroll, content, state);
	return (
		<div className="codex-transcript-wrap">
			<div className="codex-scroll-area">
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
						follow.current =
							Date.now() >= navigatingUntil.current &&
							el.scrollHeight - el.scrollTop - el.clientHeight < 20;
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
								onClick={loadEarlier}
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
						{turns.map((turn) => {
							const review =
								!turn.active && turn.timing?.status !== "inProgress" && state
									? buildTurnReview({
											id: `${state.threadId || state.key}:${turn.id}`,
											turnId: turn.id,
											cwd: state.cwd,
											items: turn.work,
											diff: turn.timing?.diff,
										})
									: null;
							return (
								<div className="codex-turn" key={turn.id}>
									{turn.users.map((item) => (
										<TranscriptMessage
											key={item.id}
											item={item}
											sessionKey={state?.key}
										/>
									))}
									<TurnActivity
										turn={turn}
										waiting={
											turn.active &&
											Boolean(
												state?.approvals.some((a) => a.isBlocking !== false),
											)
										}
									/>
									{review && onReviewChanges && (
										<TurnChanges review={review} onReview={onReviewChanges} />
									)}
								</div>
							);
						})}
					</div>
				</section>
				<PromptNavigator
					prompts={prompts}
					scrollRef={scroll}
					onNavigate={() => {
						follow.current = false;
						navigatingUntil.current = Date.now() + 1000;
					}}
					onEarlier={state?.historyCursor ? loadEarlier : undefined}
					loadingEarlier={loadingEarlier}
				/>
				{pinned && (
					<div className="codex-prompt-overlay">
						<TranscriptMessage
							key={pinned.id}
							item={pinned}
							sticky
							sessionKey={state?.key}
						/>
					</div>
				)}
				{showJump && (
					<button
						type="button"
						className="codex-jump"
						aria-label="Jump to latest message"
						onClick={() => {
							follow.current = true;
							navigatingUntil.current = 0;
							scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
						}}
					>
						<ArrowDown size={16} />
					</button>
				)}
			</div>
			{Boolean(state?.approvals.length) && (
				<div className="codex-question-dock">
					{state?.approvals.map((approval) => (
						<CodexApprovalCard
							key={approval.id}
							sessionKey={state.key}
							approval={approval}
						/>
					))}
				</div>
			)}
		</div>
	);
}
