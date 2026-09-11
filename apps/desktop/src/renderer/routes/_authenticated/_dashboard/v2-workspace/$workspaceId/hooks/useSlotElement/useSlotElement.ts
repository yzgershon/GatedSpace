import { useEffect, useState } from "react";

/**
 * Resolves a portal slot element mounted by a parent layout. The slot is
 * usually in the DOM before this child renders, so look it up synchronously
 * during state init — otherwise persisted-open portals flash for a frame
 * while the post-mount effect fills the ref.
 */
export function useSlotElement(id: string): HTMLElement | null {
	const [slotEl, setSlotEl] = useState<HTMLElement | null>(() =>
		typeof document !== "undefined" ? document.getElementById(id) : null,
	);
	/*
	 * Re-resolved after EVERY commit, not only when the current value changes.
	 *
	 * A slot can be conditional on something that settles late — the group
	 * switcher's slot only exists under `shellChrome: "topbar"`, and the skin
	 * comes from user preferences. An effect keyed on the current value would
	 * look once, find nothing, set null, and never look again, because setting
	 * state to the value it already holds does not re-run the effect. The
	 * portal would then be missing until a reload, and the group switcher is
	 * the only way to change groups when the tab strip is off.
	 *
	 * IT MUST NOT CALL setState UNLESS SOMETHING ACTUALLY CHANGED, and the
	 * early returns below are the whole reason this is safe. An effect with no
	 * dependency array that calls setState unconditionally is an infinite
	 * render loop: React's "same value, skip the re-render" bailout only holds
	 * while no other update is pending, and in a workspace with a streaming
	 * session there is always another update pending. The first version of this
	 * relied on that bailout and produced "Maximum update depth exceeded" a few
	 * seconds after the workspace opened.
	 *
	 * `isConnected` rather than a plain null check: a slot that was removed from
	 * the DOM (the skin changed) leaves a live reference to a detached node, and
	 * portaling into one renders nothing, silently.
	 */
	useEffect(() => {
		if (slotEl?.isConnected) return;
		const next = document.getElementById(id);
		if (next === slotEl) return;
		setSlotEl(next);
	});
	return slotEl;
}
