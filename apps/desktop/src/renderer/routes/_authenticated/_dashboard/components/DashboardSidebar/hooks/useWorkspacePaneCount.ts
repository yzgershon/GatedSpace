/**
 * How many panes a given workspace has open.
 *
 * Reads `v2WorkspaceLocalState`, which persists a `paneLayout` for EVERY
 * workspace — not just the active one. That distinction is the reason this is
 * possible at all: the earlier assessment ruled a pane badge out because
 * `stores/tabs` only holds the active workspace's panes, which would have put a
 * badge on one row and nothing on the rest.
 *
 * The collection is already loaded in full by the sidebar (it orders rows
 * across projects from the same rows), so this adds no read.
 */
import { eq } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
import { useCollections } from "renderer/routes/_authenticated/providers/CollectionsProvider";
import {
	type CountablePaneLayout,
	countWorkspacePanes,
} from "../utils/countWorkspacePanes";

export function useWorkspacePaneCount(workspaceId: string): number {
	const collections = useCollections();
	const { data: rows = [] } = useLiveQuery(
		(query) =>
			query
				.from({ v2WorkspaceLocalState: collections.v2WorkspaceLocalState })
				.where(({ v2WorkspaceLocalState }) =>
					eq(v2WorkspaceLocalState.workspaceId, workspaceId),
				),
		[collections, workspaceId],
	);

	return countWorkspacePanes(
		rows[0]?.paneLayout as CountablePaneLayout | undefined,
	);
}
