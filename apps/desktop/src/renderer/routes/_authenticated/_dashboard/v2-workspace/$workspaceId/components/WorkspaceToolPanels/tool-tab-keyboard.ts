import type { KeyboardCoordinateGetter } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";

// Expanded and icon-only tabs have different widths. Align their centers so
// closestCenter selects the next tab, rather than the wide tab being dragged.
export const toolTabKeyboardCoordinates: KeyboardCoordinateGetter = (
	event,
	args,
) => {
	if (event.code !== "ArrowLeft" && event.code !== "ArrowRight") {
		return sortableKeyboardCoordinates(event, args);
	}
	const { active, over, collisionRect, droppableContainers, droppableRects } =
		args.context;
	const sortable = active?.data.current?.sortable;
	if (!active || !collisionRect || !sortable) return;
	event.preventDefault();
	const siblings = droppableContainers
		.getEnabled()
		.filter(
			(entry) =>
				entry.data.current?.sortable?.containerId === sortable.containerId &&
				droppableRects.has(entry.id),
		)
		.sort(
			(a, b) => a.data.current?.sortable.index - b.data.current?.sortable.index,
		);
	const current = siblings.findIndex(
		(entry) => entry.id === (over?.id ?? active.id),
	);
	const target = siblings[current + (event.code === "ArrowRight" ? 1 : -1)];
	const rect = target && droppableRects.get(target.id);
	if (current < 0 || !rect) return;
	return {
		x:
			args.currentCoordinates.x +
			rect.left +
			rect.width / 2 -
			collisionRect.left -
			collisionRect.width / 2,
		y: args.currentCoordinates.y,
	};
};
