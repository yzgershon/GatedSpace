import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useId, useState } from "react";
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
	const [open, setOpen] = useState(true);
	const reduced = useReducedMotion();
	const id = useId();
	return (
		<div className="codex-turn-activity">
			<WorkHeading
				active={turn.active}
				waiting={waiting}
				label={activeWorkLabel(turn)}
				timing={turn.timing}
				open={open}
				controls={id}
				onToggle={() => setOpen(!open)}
			/>
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
	);
}
