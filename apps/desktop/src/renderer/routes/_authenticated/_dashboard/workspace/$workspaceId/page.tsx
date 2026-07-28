/**
 * Legacy v1 workspace route — now a redirect to the same workspace in v2.
 *
 * v1 was upstream's original workspace UI, kept alongside v2 during their
 * migration. GatedSpace only ever used v2, and the v1 tree is being removed.
 *
 * The route is kept as a redirect rather than deleted so that anything still
 * pointing at it lands on the real workspace instead of a "not found": old
 * router history, a persisted deep link, or an external `superset://` style
 * link someone saved. The workspace id is the same on both sides, so the
 * redirect is exact rather than a bounce to a chooser.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute(
	"/_authenticated/_dashboard/workspace/$workspaceId/",
)({
	beforeLoad: ({ params }) => {
		throw redirect({
			to: "/v2-workspace/$workspaceId",
			params: { workspaceId: params.workspaceId },
			replace: true,
		});
	},
});
