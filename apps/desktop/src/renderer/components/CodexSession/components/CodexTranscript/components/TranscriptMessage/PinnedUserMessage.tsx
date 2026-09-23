import { ChevronDown } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { CodexItem } from "shared/codex-session/types";
import { TranscriptImages } from "./TranscriptImages";

/** One readable line and a fading second line, with small image previews. */
export function PinnedUserMessage({
	item,
	sessionKey,
}: {
	item: CodexItem;
	sessionKey?: string;
}) {
	const [expanded, setExpanded] = useState(false);
	const [overflowing, setOverflowing] = useState(false);
	const body = useRef<HTMLSpanElement>(null);
	const imageCount =
		(item.images?.length ?? 0) + (item.imagePaths?.length ?? 0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: text can change without changing the clamped element height.
	useLayoutEffect(() => {
		if (!body.current || expanded) return;
		const el = body.current;
		const measure = () => setOverflowing(el.scrollHeight > 21);
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		measure();
		return () => observer.disconnect();
	}, [expanded, item.text]);
	return (
		<div
			className="codex-pinned-prompt"
			data-expanded={expanded}
			data-pinned-id={item.id}
		>
			{imageCount > 0 && (
				<div className="codex-pinned-images">
					<TranscriptImages
						item={item}
						sessionKey={sessionKey}
						limit={expanded ? undefined : 2}
					/>
					{imageCount > 2 && !expanded && (
						<button
							type="button"
							className="codex-pinned-more"
							aria-label={`Show all ${imageCount} images`}
							onClick={() => setExpanded(true)}
						>
							+{imageCount - 2}
						</button>
					)}
				</div>
			)}
			{item.text && (
				<button
					type="button"
					className="codex-pinned-toggle"
					aria-label={
						overflowing || expanded
							? `${expanded ? "Collapse" : "Expand"} pinned prompt`
							: "Pinned prompt"
					}
					aria-expanded={overflowing || expanded ? expanded : undefined}
					onClick={() => (overflowing || expanded) && setExpanded(!expanded)}
				>
					<span
						ref={body}
						className={`codex-pinned-text ${!expanded && overflowing ? "is-faded" : ""}`}
					>
						{item.text}
					</span>
					{(overflowing || expanded) && (
						<ChevronDown className={expanded ? "is-expanded" : ""} size={14} />
					)}
				</button>
			)}
			{!item.text && expanded && (
				<button
					type="button"
					className="codex-pinned-more"
					aria-label="Collapse pinned prompt"
					onClick={() => setExpanded(false)}
				>
					<ChevronDown className="is-expanded" size={14} />
				</button>
			)}
		</div>
	);
}
