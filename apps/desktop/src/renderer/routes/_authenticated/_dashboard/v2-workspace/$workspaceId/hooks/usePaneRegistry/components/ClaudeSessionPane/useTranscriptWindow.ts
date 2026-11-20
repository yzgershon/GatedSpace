import {
	type RefObject,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { TimelineItem } from "shared/claude-session/timeline";
import { historyPageStart, visibleTranscriptItems } from "./transcript-window";

/** UI-only window: keep the source timeline intact and pin the page while reading. */
export function useTranscriptWindow({
	items,
	sessionKey,
	scrollRef,
	followingRef,
	onBeforeReveal,
}: {
	items: TimelineItem[];
	sessionKey?: string;
	scrollRef?: RefObject<HTMLElement | null>;
	followingRef?: RefObject<boolean>;
	onBeforeReveal?: () => void;
}) {
	const [expanded, setExpanded] = useState<{ key?: string; firstId: string }>();
	const committed = useRef<{ key?: string; firstId?: string }>({});
	const pendingScroll = useRef<{ top: number; height: number } | null>(null);
	const start = useMemo(() => {
		const firstId =
			expanded && expanded.key === sessionKey
				? expanded.firstId
				: followingRef?.current === false &&
						committed.current.key === sessionKey
					? committed.current.firstId
					: undefined;
		const anchor = firstId
			? items.findIndex((item) => item.id === firstId)
			: -1;
		return anchor >= 0 ? anchor : historyPageStart(items);
	}, [items, expanded, sessionKey, followingRef]);
	const visible = useMemo(
		() => visibleTranscriptItems(items, start),
		[items, start],
	);

	useLayoutEffect(() => {
		committed.current = { key: sessionKey, firstId: items[start]?.id };
		const previous = pendingScroll.current;
		const scroll = scrollRef?.current;
		if (previous && scroll) {
			scroll.scrollTop = previous.top + scroll.scrollHeight - previous.height;
		}
		pendingScroll.current = null;
	}, [items, start, sessionKey, scrollRef]);

	return {
		items: visible,
		hasEarlier: start > 0,
		loadEarlier: () => {
			const first = items[historyPageStart(items, start)];
			if (!first) return;
			onBeforeReveal?.();
			const scroll = scrollRef?.current;
			if (scroll)
				pendingScroll.current = {
					top: scroll.scrollTop,
					height: scroll.scrollHeight,
				};
			setExpanded({ key: sessionKey, firstId: first.id });
		},
	};
}
