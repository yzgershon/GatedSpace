import { useMatchRoute, useNavigate, useSearch } from "@tanstack/react-router";

export function validateFlockSearch(search: Record<string, unknown>): {
	flock?: boolean;
} {
	return { flock: search.flock === true ? true : undefined };
}

/** Flock is a view of the current workspace, not a different workspace. */
export function useFlockNavigation() {
	const navigate = useNavigate();
	const match = useMatchRoute();
	const search = useSearch({ strict: false });
	const legacyRoute = Boolean(match({ to: "/ensemble", fuzzy: true }));
	return {
		open: legacyRoute || search.flock === true,
		show: () =>
			navigate({
				to: ".",
				search: (previous) => ({ ...previous, flock: true }),
				resetScroll: false,
			}),
		hide: () =>
			legacyRoute
				? navigate({ to: "/v2-workspace", search: {}, replace: true })
				: navigate({
						to: ".",
						search: (previous) => ({ ...previous, flock: undefined }),
						resetScroll: false,
					}),
	};
}
