import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronRight, Pencil, SquareTerminal } from "lucide-react";
import { useId, useState } from "react";
import type { CodexItem } from "shared/codex-session/types";
import { groupLabel } from "../../activity";
import { ActivityRow } from "../ActivityRow/ActivityRow";

export function ActivityGroup({
	items,
	active,
}: {
	items: CodexItem[];
	active: boolean;
}) {
	const [open, setOpen] = useState(true);
	const reduced = useReducedMotion();
	const id = useId();
	const multiple = items.length > 1;
	const Icon = items.some((i) => i.activityType === "fileChange")
		? Pencil
		: SquareTerminal;
	return (
		<div className="codex-action-group">
			{multiple && (
				<button
					type="button"
					className="codex-group-heading"
					aria-expanded={open}
					aria-controls={id}
					onClick={() => setOpen(!open)}
				>
					<Icon size={16} />
					<span>{groupLabel(items)}</span>
					<ChevronRight
						size={13}
						className={`codex-disclosure ${open ? "is-open" : ""}`}
					/>
				</button>
			)}
			<AnimatePresence initial={false}>
				{(open || !multiple) && (
					<motion.div
						id={id}
						className={`codex-reveal ${multiple ? "codex-group-rows" : ""}`}
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ duration: reduced ? 0 : 0.25 }}
					>
						{items.map((item) => (
							<ActivityRow item={item} activeTurn={active} key={item.id} />
						))}
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}
