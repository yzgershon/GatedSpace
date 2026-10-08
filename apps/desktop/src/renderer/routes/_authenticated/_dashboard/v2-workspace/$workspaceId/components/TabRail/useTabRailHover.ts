import { useCallback, useEffect, useRef, useState } from "react";

const HOVER_DELAY = 130;
const LEAVE_DELAY = 200;

/** Only deliberate pointer movement changes the expanded tab, never layout. */
export function useTabRailHover(onHoverIntent: () => void) {
	const [hoveredId, setHoveredId] = useState<string | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pending = useRef<string | null>(null);
	const current = useRef<string | null>(null);
	const origin = useRef<{ x: number; y: number } | null>(null);
	const pointer = useRef<{ x: number; y: number } | null>(null);
	const intent = useRef(onHoverIntent);
	intent.current = onHoverIntent;
	const cancel = useCallback(() => {
		if (timer.current !== null) clearTimeout(timer.current);
		timer.current = null;
		pending.current = null;
	}, []);
	useEffect(() => cancel, [cancel]);
	const clear = useCallback(() => {
		cancel();
		current.current = null;
		origin.current = null;
		setHoveredId(null);
	}, [cancel]);
	const move = useCallback(
		(id: string | null, x: number, y: number) => {
			pointer.current = { x, y };
			if (id === current.current) {
				cancel();
				return;
			}
			// Gaps and tiny hand movements during expansion are not a new intent.
			if (
				!id ||
				(origin.current &&
					Math.hypot(x - origin.current.x, y - origin.current.y) < 5)
			)
				return;
			if (pending.current === id) return;
			cancel();
			pending.current = id;
			timer.current = setTimeout(() => {
				timer.current = null;
				pending.current = null;
				current.current = id;
				origin.current = pointer.current;
				intent.current();
				setHoveredId(id);
			}, HOVER_DELAY);
		},
		[cancel],
	);
	const leave = useCallback(() => {
		cancel();
		timer.current = setTimeout(clear, LEAVE_DELAY);
	}, [cancel, clear]);
	return { hoveredId, move, leave, clear, cancel };
}
