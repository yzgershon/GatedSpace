import { type RefObject, useLayoutEffect, useState } from "react";
import type { CodexSessionState } from "shared/codex-session/types";

/** Pin the prompt at the viewport's leading edge, only once its original is gone. */
export function useScrolledPrompt(
	scroll: RefObject<HTMLElement | null>,
	content: RefObject<HTMLDivElement | null>,
	state?: CodexSessionState,
) {
	const [pinnedId, setPinnedId] = useState<string | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: streamed snapshots may replace or reorder the measured messages.
	useLayoutEffect(() => {
		const viewport = scroll.current;
		const body = content.current;
		if (!viewport || !body) return;
		let frame = 0;
		const measure = () => {
			const top = viewport.getBoundingClientRect().top + 1;
			let id: string | null = null;
			for (const prompt of body.querySelectorAll<HTMLElement>(
				"[data-prompt-id]",
			)) {
				const bounds = prompt.getBoundingClientRect();
				if (bounds.top > top) {
					// Leave room for the next original prompt as it enters the sticky
					// area, including a navigator jump that lands just below the top.
					if (bounds.top < top + 88) id = null;
					break;
				}
				id = bounds.bottom <= top ? (prompt.dataset.promptId ?? null) : null;
			}
			setPinnedId(id);
		};
		const schedule = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(measure);
		};
		const observer = new ResizeObserver(schedule);
		observer.observe(body);
		observer.observe(viewport);
		viewport.addEventListener("scroll", schedule, { passive: true });
		measure();
		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
			viewport.removeEventListener("scroll", schedule);
		};
	}, [scroll, content, state]);
	return state?.items.find(
		(item) => item.id === pinnedId && item.kind === "user",
	);
}
