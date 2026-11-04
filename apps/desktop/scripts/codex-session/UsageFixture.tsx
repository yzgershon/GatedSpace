import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { publishCodexSession } from "renderer/lib/codex-session/store";
import { DashboardSidebarUsageBar } from "renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/components/DashboardSidebarUsageBar/DashboardSidebarUsageBar";
import { useFocusedSession } from "renderer/stores/focused-session";
import { electronTrpcClient } from "./fixture-client";

export function UsageFixture() {
	const client = useQueryClient();
	useEffect(() => {
		const setProvider = (provider: "codex" | "claude") =>
			useFocusedSession.getState().set({ paneId: "fixture", provider });
		Object.assign(window, { setUsageProvider: setProvider });
		setProvider("codex");
		void electronTrpcClient.codexSession.start
			.mutate({ key: "fixture" })
			.then(publishCodexSession);
		const update = () =>
			void client.invalidateQueries({ queryKey: ["codex-account-usage"] });
		window.addEventListener("codex-fixture-usage", update);
		return () => window.removeEventListener("codex-fixture-usage", update);
	}, [client]);
	return (
		<main style={{ padding: 24, maxWidth: 360 }}>
			<h1 style={{ marginBottom: 24 }}>Usage display verification</h1>
			<DashboardSidebarUsageBar />
		</main>
	);
}
