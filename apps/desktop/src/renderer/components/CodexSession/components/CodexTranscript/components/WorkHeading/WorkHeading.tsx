import { Check, ChevronRight, CircleAlert, Pause } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CodexTurn } from "shared/codex-session/types";
import { formatDuration } from "../../activity";

/** Keep the clock local: ticking must not rerender markdown or large tool results. */
export function WorkHeading({
	active,
	waiting,
	label,
	timing,
	open,
	controls,
	onToggle,
}: {
	active: boolean;
	waiting: boolean;
	label: string;
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
			onClick={onToggle}
		>
			{active && !waiting ? (
				<span
					className="codex-work-symbol codex-thinking-wave"
					aria-hidden="true"
				>
					<i />
					<i />
					<i />
					<i />
				</span>
			) : waiting ? (
				<Pause className="codex-work-symbol" size={16} />
			) : failed || stopped ? (
				<CircleAlert className="codex-work-symbol" size={16} />
			) : (
				<Check className="codex-work-symbol" size={16} />
			)}
			<span className="codex-work-label" aria-live="polite" aria-atomic="true">
				<span key={waiting ? "waiting" : active ? label : "settled"}>
					{waiting
						? "Waiting for your response"
						: active
							? label
							: failed
								? "Run failed"
								: stopped
									? "Stopped"
									: "Worked"}
					{!active && !waiting && duration !== undefined
						? ` for ${formatDuration(duration)}`
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
