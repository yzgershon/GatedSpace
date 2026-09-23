import { ChevronRight, FileDiff } from "lucide-react";
import { useEffect, useRef } from "react";
import type { CodexTurnReview as Review } from "shared/codex-session/review";
import { ReviewPatch } from "./components/ReviewPatch";
import "./codex-turn-review.css";

export function CodexTurnReview({ review }: { review: Review }) {
	const root = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!review.selectedPath) return;
		const file = [
			...(root.current?.querySelectorAll<HTMLDetailsElement>(
				"details[data-path]",
			) ?? []),
		].find((el) => el.dataset.path === review.selectedPath);
		if (file) {
			file.open = true;
			file.scrollIntoView({ block: "start" });
		}
	}, [review]);
	return (
		<section className="codex-turn-review" aria-label="Task changes" ref={root}>
			<header className="codex-review-toolbar">
				<span>
					This task · {review.files.length}{" "}
					{review.files.length === 1 ? "file" : "files"}
				</span>
				<span className="codex-change-stats">
					<span>+{review.added}</span>
					<span>−{review.removed}</span>
				</span>
			</header>
			<div className="codex-review-files">
				{review.files.map((file) => (
					<details
						open
						key={file.path}
						data-path={file.path}
						className="codex-review-file"
					>
						<summary>
							<ChevronRight size={14} />
							<FileDiff size={15} />
							<span title={file.path}>{file.path}</span>
							<span className="codex-change-stats">
								<span>+{file.added}</span>
								<span>−{file.removed}</span>
							</span>
						</summary>
						{file.diffs.length ? (
							file.diffs.map((patch, index) => (
								<ReviewPatch
									key={`${index}:${patch.length}`}
									patch={patch}
									path={file.path}
								/>
							))
						) : (
							<p className="codex-review-empty">
								No text diff was supplied for this file.
							</p>
						)}
					</details>
				))}
			</div>
		</section>
	);
}
