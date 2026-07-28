import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
	component: RootIndexPage,
});

function RootIndexPage() {
	// Was "/workspace" — the v1 index. v1 is being removed, and sending launches
	// there meant landing on the "Pick a workspace" placeholder every time.
	return <Navigate to="/v2-workspace" replace />;
}
