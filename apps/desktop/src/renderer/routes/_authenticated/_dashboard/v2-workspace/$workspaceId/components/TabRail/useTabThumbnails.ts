import { useCallback, useEffect, useRef, useState } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";

/** Last-seen pixels only. Bounded, memory-only, event-driven; never wake hidden sessions. */
export function useTabThumbnails(
	workspaceId: string,
	activeTabId: string | null,
	tabIds: string[],
) {
	const [images, setImages] = useState<Map<string, string>>(() => new Map());
	const current = useRef(activeTabId);
	const generation = useRef(0);
	if (current.current !== activeTabId) generation.current++;
	current.current = activeTabId;
	const busy = useRef(false);
	const last = useRef({ id: "", at: 0 });
	const alive = useRef(true);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);
	const capture = useCallback(async () => {
		const id = current.current;
		const requestGeneration = generation.current;
		if (!id || busy.current || document.visibilityState !== "visible") return;
		if (last.current.id === id && Date.now() - last.current.at < 1000) return;
		const root = document.querySelector<HTMLElement>(
			`[data-workspace-preview="${CSS.escape(workspaceId)}"]`,
		);
		if (!root) return;
		const { x, y, width, height } = root.getBoundingClientRect();
		if (width < 8 || height < 8) return;
		busy.current = true;
		last.current = { id, at: Date.now() };
		try {
			const image = await electronTrpcClient.window.captureTabThumbnail.query({
				x,
				y,
				width,
				height,
			});
			// A late capture must never be assigned to a tab that is no longer on screen.
			if (
				!image ||
				!alive.current ||
				current.current !== id ||
				generation.current !== requestGeneration
			)
				return;
			setImages((previous) => {
				const next = new Map(previous);
				next.delete(id);
				next.set(id, image);
				if (next.size > 24) next.delete(next.keys().next().value as string);
				return next;
			});
		} catch {
			/* An unavailable capture leaves the real pane layout visible. */
		} finally {
			busy.current = false;
		}
	}, [workspaceId]);
	useEffect(() => {
		if (!activeTabId) return;
		const timer = setTimeout(() => void capture(), 650);
		return () => clearTimeout(timer);
	}, [activeTabId, capture]);
	const ids = JSON.stringify(tabIds);
	useEffect(() => {
		const valid = new Set<string>(JSON.parse(ids));
		setImages((previous) => {
			if ([...previous.keys()].every((id) => valid.has(id))) return previous;
			return new Map([...previous].filter(([id]) => valid.has(id)));
		});
	}, [ids]);
	return { images, capture };
}
