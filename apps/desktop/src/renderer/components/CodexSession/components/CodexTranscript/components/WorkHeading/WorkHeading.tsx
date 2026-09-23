import { ChevronRight, CircleAlert, Pause } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CodexTurn } from "shared/codex-session/types";
import { formatDuration } from "../../activity";
import { ActivityWords } from "./ActivityWords";

/** Keep the clock local: ticking must not rerender markdown or large tool results. */
export function WorkHeading({
	active,
	waiting,
	label,
	messageCount,
	timing,
	open,
	controls,
	onToggle,
}: {
	active: boolean;
	waiting: boolean;
	label: string;
	messageCount: number;
	timing?: CodexTurn;
	open: boolean;
	controls: string;
	onToggle: () => void;
}) {
	const [now, setNow] = useState(Date.now);
	const headingRef = useRef<HTMLButtonElement>(null);
	const [visible, setVisible] = useState(true);
	useEffect(() => {
		if (!active || !headingRef.current) return;
		let inView = true;
		const update = () => setVisible(inView && !document.hidden);
		const observer = new IntersectionObserver(([entry]) => {
			inView = entry.isIntersecting;
			update();
		});
		observer.observe(headingRef.current);
		document.addEventListener("visibilitychange", update);
		update();
		return () => {
			observer.disconnect();
			document.removeEventListener("visibilitychange", update);
		};
	}, [active]);
	const animate = active && !waiting && visible;
	useEffect(() => {
		if (!animate) return;
		setNow(Date.now());
		const timer = setInterval(() => {
			setNow(Date.now());
		}, 1000);
		return () => clearInterval(timer);
	}, [animate]);
	const end = active ? now : timing?.completedAt;
	const duration =
		timing?.durationMs ??
		(timing?.startedAt !== undefined && end !== undefined
			? end - timing.startedAt
			: undefined);
	const stopped = timing?.status === "interrupted";
	const failed = timing?.status === "failed";
	return (
		<button
			ref={headingRef}
			type="button"
			className={`codex-work-heading ${active ? "is-working" : ""}`}
			data-motion={animate ? "running" : "paused"}
			aria-expanded={open}
			aria-controls={controls}
			title={
				!active && duration !== undefined
					? `Worked for ${formatDuration(duration)}`
					: undefined
			}
			onClick={onToggle}
		>
			{waiting ? (
				<Pause className="codex-work-symbol" size={16} />
			) : !active && (failed || stopped) ? (
				<CircleAlert className="codex-work-symbol" size={16} />
			) : null}
			<span className="codex-work-label">
				{active && !waiting && (
					<ActivityWords
						key={`activity-${label}`}
						label={label}
						animate={animate}
					/>
				)}
				<span
					className={active && !waiting ? "sr-only" : undefined}
					aria-live="polite"
					aria-atomic="true"
					key="accessible-status"
				>
					{waiting
						? "Waiting for your response"
						: active
							? label
							: failed
								? "Run failed"
								: stopped
									? "Stopped"
									: `${messageCount} previous ${messageCount === 1 ? "message" : "messages"}`}
					{!active && (failed || stopped) && messageCount > 0
						? ` · ${messageCount} previous ${messageCount === 1 ? "message" : "messages"}`
						: ""}
				</span>
			</span>
			{active && !waiting && duration !== undefined && (
				<span className="codex-work-elapsed" aria-hidden="true">
					{formatDuration(duration)}
				</span>
			)}
			<ChevronRight
				size={14}
				className={`codex-disclosure ${open ? "is-open" : ""}`}
			/>
		</button>
	);
}
