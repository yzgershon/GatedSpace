import {
	ArrowUpRight,
	Check,
	ChevronUp,
	MessageSquare,
	Square,
} from "lucide-react";
import { useId, useState } from "react";
import type { SessionProgress } from "shared/session-progress";
import "./session-activity-pill.css";

const labels = {
	working: "Working",
	question: "Needs your reply",
	complete: "Task complete",
	error: "Needs attention",
	idle: "Ready when you are",
};
export function SessionActivityPill({
	progress,
	title,
	onReturn,
	onStop,
}: {
	progress: SessionProgress;
	title: string;
	onReturn: () => void;
	onStop: () => Promise<unknown>;
}) {
	const [details, setDetails] = useState(false);
	const [stopping, setStopping] = useState(false);
	const [error, setError] = useState("");
	const id = useId();
	return (
		<div className="session-preview-activity" data-status={progress.status}>
			{details && (
				<div className="session-preview-events" id={id}>
					<strong>Latest activity</strong>
					<ol>
						{progress.events.map((event, index) => (
							<li key={`${index}:${event}`}>{event}</li>
						))}
					</ol>
					{!progress.events.length && <p>{progress.detail}</p>}
				</div>
			)}
			{error && (
				<p className="select-text cursor-text session-preview-error">{error}</p>
			)}
			<div className="session-preview-pill">
				<button
					type="button"
					className="session-preview-main"
					aria-label="Show session activity"
					aria-expanded={details}
					aria-controls={id}
					onClick={() => setDetails(!details)}
				>
					<span className="session-preview-symbol">
						{progress.status === "complete" ? (
							<Check size={22} />
						) : (
							<MessageSquare size={22} />
						)}
					</span>
					<span className="session-preview-copy">
						<span>
							<strong>{labels[progress.status]}</strong>
							<small>{title}</small>
						</span>
						<span title={progress.detail}>{progress.detail}</span>
					</span>
					<ChevronUp size={15} />
				</button>
				<button
					type="button"
					className="session-preview-action"
					aria-label="Return to session"
					title="Return to session"
					onClick={onReturn}
				>
					<ArrowUpRight size={21} />
				</button>
				{progress.canStop && (
					<button
						type="button"
						className="session-preview-action"
						aria-label="Stop task"
						title="Stop task"
						disabled={stopping}
						onClick={() => {
							setStopping(true);
							setError("");
							void onStop()
								.catch((e) =>
									setError(e instanceof Error ? e.message : String(e)),
								)
								.finally(() => setStopping(false));
						}}
					>
						<Square size={15} fill="currentColor" />
					</button>
				)}
			</div>
		</div>
	);
}
