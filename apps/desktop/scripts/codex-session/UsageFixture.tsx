import { useEffect } from "react";
import { DashboardSidebarUsageBar } from "renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/components/DashboardSidebarUsageBar/DashboardSidebarUsageBar";
import { useFocusedSession } from "renderer/stores/focused-session";

export function UsageFixture() {
	useEffect(() => {
		const setProvider = (provider: "codex" | "claude") =>
			useFocusedSession.getState().set({ paneId: "fixture", provider });
		Object.assign(window, { setUsageProvider: setProvider });
		setProvider("codex");
	}, []);
	return (
		<main style={{ padding: 24, maxWidth: 360 }}>
			<h1 style={{ marginBottom: 24 }}>Usage display verification</h1>
			<DashboardSidebarUsageBar />
		</main>
	);
}
