import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useId, useLayoutEffect, useState } from "react";
import {
	activeWorkLabel,
	groupActivities,
	type TranscriptTurn,
} from "../../activity";
import { ActivityGroup } from "../ActivityGroup/ActivityGroup";
import { TranscriptMessage } from "../TranscriptMessage/TranscriptMessage";
import { WorkHeading } from "../WorkHeading/WorkHeading";

export function TurnActivity({
	turn,
	waiting,
}: {
	turn: TranscriptTurn;
	waiting: boolean;
}) {
	const [open, setOpen] = useState(turn.active);
	useLayoutEffect(() => setOpen(turn.active), [turn.active]);
	const reduced = useReducedMotion();
	const id = useId();
	const hasWork =
		turn.work.length > 0 ||
		turn.active ||
		turn.timing?.status === "failed" ||
		turn.timing?.status === "interrupted";
	const heading = (
		<WorkHeading
			active={turn.active}
			waiting={waiting}
			label={activeWorkLabel(turn)}
			messageCount={turn.work.length}
			timing={turn.timing}
			open={open}
			controls={id}
			onToggle={() => setOpen(!open)}
		/>
	);
	return (
		<>
			{hasWork && (
				<div className="codex-turn-activity">
					{!turn.active && heading}
					<AnimatePresence initial={false}>
						{open && (
							<motion.div
								id={id}
								className="codex-reveal codex-work-body"
								initial={{ height: 0, opacity: 0 }}
								animate={{ height: "auto", opacity: 1 }}
								exit={{ height: 0, opacity: 0 }}
								transition={{
									duration: reduced ? 0 : 0.28,
									ease: [0.22, 1, 0.36, 1],
								}}
							>
								{groupActivities(turn.work).map((group) =>
									group[0].kind === "assistant" ? (
										<TranscriptMessage item={group[0]} key={group[0].id} />
									) : (
										<ActivityGroup
											items={group}
											active={turn.active}
											key={group[0].id}
										/>
									),
								)}
							</motion.div>
						)}
					</AnimatePresence>
				</div>
			)}
			{turn.answers.map((item) => (
				<TranscriptMessage key={item.id} item={item} />
			))}
			{turn.active && <div className="codex-live-activity">{heading}</div>}
		</>
	);
}
