import { type DragEvent, useEffect, useState } from "react";

/** Share native file-drop handling without claiming text selection or pane
 * drags. Let events bubble so react-dnd can finish its native drag lifecycle. */
export function useComposerFileDrop(attach: (files: File[]) => Promise<void>) {
	const [dragging, setDragging] = useState(false);
	useEffect(() => {
		const clear = () => setDragging(false);
		window.addEventListener("drop", clear);
		window.addEventListener("dragend", clear);
		window.addEventListener("blur", clear);
		return () => {
			window.removeEventListener("drop", clear);
			window.removeEventListener("dragend", clear);
			window.removeEventListener("blur", clear);
		};
	}, []);
	return {
		dragging,
		handlers: {
			onDragOver(event: DragEvent<HTMLDivElement>) {
				if (!event.dataTransfer.types.includes("Files")) return;
				event.preventDefault();
				event.dataTransfer.dropEffect = "copy";
				setDragging(true);
			},
			onDragLeave(event: DragEvent<HTMLDivElement>) {
				if (!event.currentTarget.contains(event.relatedTarget as Node | null))
					setDragging(false);
			},
			onDrop(event: DragEvent<HTMLDivElement>) {
				setDragging(false);
				const files = Array.from(event.dataTransfer.files);
				if (!files.length) return;
				event.preventDefault();
				void attach(files);
			},
		},
	};
}
