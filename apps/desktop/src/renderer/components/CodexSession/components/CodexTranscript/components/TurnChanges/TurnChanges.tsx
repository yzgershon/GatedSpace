import { ArrowUpRight, FileDiff } from "lucide-react";
import type { CodexTurnReview } from "shared/codex-session/review";

export function TurnChanges({
	review,
	onReview,
}: {
	review: CodexTurnReview;
	onReview: (review: CodexTurnReview) => void;
}) {
	return (
		<section
			className="codex-turn-changes"
			aria-label="Files edited in this task"
		>
			<header>
				<span className="codex-changes-symbol">
					<FileDiff size={20} />
				</span>
				<div className="codex-changes-title">
					<strong>
						Edited {review.files.length}{" "}
						{review.files.length === 1 ? "file" : "files"}
					</strong>
					<span className="codex-change-stats">
						<span>+{review.added}</span>
						<span>−{review.removed}</span>
					</span>
				</div>
				<button
					type="button"
					className="codex-review-button"
					onClick={() => onReview(review)}
				>
					Review <ArrowUpRight size={14} />
				</button>
			</header>
			<div className="codex-changes-files">
				{review.files.map((file) => (
					<button
						type="button"
						key={file.path}
						title={file.path}
						onClick={() => onReview({ ...review, selectedPath: file.path })}
					>
						<span className="codex-change-path">{file.path}</span>
						<span className="codex-change-stats">
							<span>+{file.added}</span>
							<span>−{file.removed}</span>
						</span>
					</button>
				))}
			</div>
		</section>
	);
}
