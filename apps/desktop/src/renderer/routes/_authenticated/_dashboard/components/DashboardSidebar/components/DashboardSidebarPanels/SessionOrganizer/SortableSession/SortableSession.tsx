import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { ReactNode } from "react";
import { sessionKey } from "shared/session-organization";
import type { CollectionSession } from "../../SessionCollectionRow/SessionCollectionRow";

export const sessionDragId = (group: string, session: CollectionSession) =>
	`${group}/${sessionKey(session)}`;
export function SortableSession({
	session,
	group,
	disabled,
	children,
}: {
	session: CollectionSession;
	group: string;
	disabled: boolean;
	children: (handle: ReactNode) => ReactNode;
}) {
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({
		id: sessionDragId(group, session),
		data: { session, group },
		disabled,
	});
	return (
		<div
			ref={setNodeRef}
			data-session-key={sessionKey(session)}
			style={{
				transform: CSS.Translate.toString(transform),
				transition,
				opacity: isDragging ? 0.3 : undefined,
			}}
		>
			{children(
				!disabled && (
					<button
						type="button"
						className="session-drag-handle"
						ref={setActivatorNodeRef}
						{...attributes}
						{...listeners}
						aria-label={`Move ${session.title}`}
						title="Drag to reorder or move to a project. Space to pick up, arrows to move, Escape to cancel."
					>
						<GripVertical size={13} />
					</button>
				),
			)}
		</div>
	);
}
