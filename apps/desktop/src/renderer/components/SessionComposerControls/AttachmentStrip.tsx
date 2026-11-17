import { type ReactNode, useEffect, useRef } from "react";

/** Keep attachment scrolling local to the composer, including ordinary mice. */
export function AttachmentStrip({ children }: { children: ReactNode }) {
	const ref = useRef<HTMLFieldSetElement>(null);
	useEffect(() => {
		const node = ref.current;
		if (!node) return;
		const wheel = (event: WheelEvent) => {
			if (event.ctrlKey || node.scrollWidth <= node.clientWidth) return;
			const delta =
				Math.abs(event.deltaX) > Math.abs(event.deltaY)
					? event.deltaX
					: event.deltaY;
			if (!delta) return;
			event.preventDefault();
			node.scrollLeft +=
				delta *
				(event.deltaMode === 1
					? 16
					: event.deltaMode === 2
						? node.clientWidth
						: 1);
		};
		node.addEventListener("wheel", wheel, { passive: false });
		return () => node.removeEventListener("wheel", wheel);
	}, []);
	return (
		<fieldset ref={ref} className="session-images" aria-label="Attached images">
			{children}
		</fieldset>
	);
}
