import { useCallback, useEffect, useRef, useState } from "react";

export function useTabRailOverflow(
	expandedId: string | null,
	count: number,
	renaming: boolean,
	activeId: string | null,
) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const manual = useRef(false);
	const [revealTick, setRevealTick] = useState(0);
	const previous = useRef({ activeId, count, renaming, revealTick });
	const reveal = useCallback(() => {
		manual.current = false;
		setRevealTick((tick) => tick + 1);
	}, []);
	const holdPosition = useCallback(() => {
		manual.current = true;
	}, []);
	const [edges, setEdges] = useState({ left: false, right: false });
	useEffect(() => {
		if (
			previous.current.activeId !== activeId ||
			previous.current.count !== count ||
			previous.current.renaming !== renaming ||
			previous.current.revealTick !== revealTick
		)
			manual.current = false;
		previous.current = { activeId, count, renaming, revealTick };
		if (renaming || !count) return;
		const scroll = scrollRef.current;
		if (!scroll) return;
		// Pointer leave only restores the active label. It must not cancel an
		// arrow/wheel scroll already requested by the user, including a smooth
		// scroll whose first frame runs after this effect.
		const target = [
			...scroll.querySelectorAll<HTMLElement>("[data-rail-tab]"),
		].find((node) => node.dataset.railTab === expandedId);
		const measure = () => {
			if (!manual.current && target) {
				const box = target.getBoundingClientRect(),
					area = scroll.getBoundingClientRect();
				if (area.width && (box.width > area.width || box.left < area.left))
					scroll.scrollLeft += box.left - area.left;
				else if (area.width && box.right > area.right)
					scroll.scrollLeft += box.right - area.right;
			}
			const next = {
				left: scroll.scrollLeft > 2,
				right: scroll.scrollLeft + scroll.clientWidth < scroll.scrollWidth - 2,
			};
			setEdges((prev) =>
				prev.left === next.left && prev.right === next.right ? prev : next,
			);
		};
		const wheel = (event: WheelEvent) => {
			manual.current = true;
			// Support a conventional mouse as well as horizontal trackpad gestures.
			if (
				Math.abs(event.deltaY) > Math.abs(event.deltaX) &&
				scroll.scrollWidth > scroll.clientWidth
			) {
				event.preventDefault();
				scroll.scrollLeft +=
					event.deltaY *
					(event.deltaMode === 1
						? 16
						: event.deltaMode === 2
							? scroll.clientWidth
							: 1);
			}
		};
		const observer = new ResizeObserver(measure);
		observer.observe(scroll);
		for (const item of scroll.children) observer.observe(item);
		scroll.addEventListener("scroll", measure);
		scroll.addEventListener("wheel", wheel, { passive: false });
		measure();
		return () => {
			observer.disconnect();
			scroll.removeEventListener("scroll", measure);
			scroll.removeEventListener("wheel", wheel);
		};
	}, [expandedId, count, renaming, activeId, revealTick]);
	const step = useCallback((direction: number) => {
		manual.current = true;
		const scroll = scrollRef.current;
		scroll?.scrollBy({
			left: direction * Math.max(80, scroll.clientWidth * 0.65),
			behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
				? "instant"
				: "smooth",
		});
	}, []);
	return { scrollRef, edges, step, reveal, holdPosition };
}
