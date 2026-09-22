import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
	ChevronRight,
	FileText,
	Globe,
	Image,
	ListChecks,
	Pencil,
	Search,
	SquareTerminal,
	Wrench,
} from "lucide-react";
import { useId, useState } from "react";
import type { CodexItem } from "shared/codex-session/types";
import {
	activityKind,
	activityLabel,
	diffStats,
	formatDuration,
} from "../../activity";
import { ActivityDetails } from "../ActivityDetails/ActivityDetails";

export const activityIcons = {
	commandExecution: SquareTerminal,
	fileChange: Pencil,
	read: FileText,
	search: Search,
	webSearch: Globe,
	browser: Globe,
	imageView: Image,
	reasoning: ListChecks,
	plan: ListChecks,
};

export function ActivityRow({
	item,
	activeTurn,
}: {
	item: CodexItem;
	activeTurn: boolean;
}) {
	const [open, setOpen] = useState(false);
	const reduced = useReducedMotion();
	const id = useId();
	const running = activeTurn && item.status === "inProgress";
	const failed =
		item.status === "failed" ||
		item.status === "declined" ||
		(item.exitCode !== undefined && item.exitCode !== 0);
	const kind = activityKind(item);
	const Icon = activityIcons[kind as keyof typeof activityIcons] ?? Wrench;
	const stats = diffStats(item.changes);
	const duration =
		item.durationMs ??
		(item.startedAt !== undefined && item.completedAt !== undefined
			? item.completedAt - item.startedAt
			: undefined);
	const label = activityLabel(item, running);
	return (
		<div
			className={`codex-action ${running ? "is-active" : ""} ${failed ? "is-failed" : ""}`}
		>
			<button
				type="button"
				className="codex-action-trigger"
				aria-expanded={open}
				aria-controls={id}
				onClick={() => setOpen(!open)}
				title={label}
			>
				<span className="codex-action-mark">
					<Icon size={16} />
					{running && <span className="codex-action-motion" />}
				</span>
				<span className="codex-action-label">{label}</span>
				{failed && (
					<span className="codex-tool-error">
						{item.status === "declined" ? "Declined" : "Failed"}
					</span>
				)}
				{(stats.added > 0 || stats.removed > 0) && (
					<span className="codex-diff-stats">
						<b>+{stats.added}</b>
						<em>−{stats.removed}</em>
					</span>
				)}
				{duration !== undefined && (
					<span className="codex-action-time">{formatDuration(duration)}</span>
				)}
				<ChevronRight
					size={13}
					className={`codex-disclosure ${open ? "is-open" : ""}`}
				/>
			</button>
			<AnimatePresence initial={false}>
				{open && (
					<motion.div
						id={id}
						className="codex-reveal"
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{
							duration: reduced ? 0 : 0.25,
							ease: [0.22, 1, 0.36, 1],
						}}
					>
						<ActivityDetails item={item} running={running} />
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}
