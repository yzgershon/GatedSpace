import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

const variations: Record<string, string[]> = {
	Thinking: ["Thinking", "Considering", "Working"],
	"Running commands": ["Running commands", "Executing", "Working"],
};

/** Rotate only equivalent status descriptions; tool activity remains authoritative. */
export function ActivityWords({
	label,
	animate,
}: {
	label: string;
	animate: boolean;
}) {
	const [index, setIndex] = useState(0);
	const reduced = useReducedMotion();
	const words = variations[label] ?? [label, "Working", label];
	const moving = animate && !reduced;
	useEffect(() => {
		if (!moving) return;
		const timer = window.setInterval(() => setIndex((i) => (i + 1) % 3), 3400);
		return () => window.clearInterval(timer);
	}, [moving]);
	return (
		<span
			className="codex-activity-words"
			data-animated={moving}
			aria-hidden="true"
		>
			<AnimatePresence initial={false}>
				<motion.span
					key={words[index]}
					className="codex-activity-word"
					initial={{
						opacity: 0,
						y: moving ? 7 : 0,
						filter: moving ? "blur(2px)" : "none",
					}}
					animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
					exit={{
						opacity: 0,
						y: moving ? -5 : 0,
						filter: moving ? "blur(2px)" : "none",
					}}
					transition={{ duration: moving ? 0.42 : 0, ease: [0.22, 1, 0.36, 1] }}
				>
					{reduced ? label : words[index]}
				</motion.span>
			</AnimatePresence>
		</span>
	);
}
