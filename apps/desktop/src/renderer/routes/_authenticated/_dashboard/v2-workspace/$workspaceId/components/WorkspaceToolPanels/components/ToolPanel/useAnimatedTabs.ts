import type { Tab } from "@superset/panes";
import { useEffect, useState } from "react";
import type { PaneViewerData } from "../../../../types";

/** Retain only a visual tab chip during exit; the closed pane disposes immediately. */
export function useAnimatedTabs(tabs: Tab<PaneViewerData>[]) {
	const [displayed, setDisplayed] = useState(tabs);
	useEffect(() => {
		setDisplayed((previous) => {
			const merged = [...tabs];
			for (const [index, tab] of previous.entries()) {
				if (!tabs.some((current) => current.id === tab.id))
					merged.splice(Math.min(index, merged.length), 0, tab);
			}
			return merged;
		});
		const timer = setTimeout(() => setDisplayed(tabs), 160);
		return () => clearTimeout(timer);
	}, [tabs]);
	return displayed;
}
