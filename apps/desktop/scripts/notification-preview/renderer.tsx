import { useState } from "react";
import { createRoot } from "react-dom/client";
import claude from "../../../../packages/ui/src/assets/icons/preset-icons/claude.svg";
import codex from "../../../../packages/ui/src/assets/icons/preset-icons/codex.svg";
import { AgentStatusRing } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/TabRail/components/AgentStatusRing";
import type { ActivePaneStatus } from "../../src/shared/tabs-types";
import { draculaTheme } from "../../src/shared/themes/built-in/dracula";
import "../../src/renderer/globals.css";
for (const [key, value] of Object.entries(draculaTheme.ui))
	if (typeof value === "string")
		document.documentElement.style.setProperty(
			`--${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`,
			value,
		);
document.documentElement.classList.add("dark");
document.body.style.cssText =
	"margin:0;background:var(--background);color:var(--foreground);font:15px Segoe UI,sans-serif";
const root = document.createElement("main");
document.body.append(root);
const statuses = ["working", "permission", "review", null] as const;
const labels = {
	working: "Working",
	permission: "Needs your reply",
	review: "Complete",
	idle: "Idle",
};
function Preview() {
	const [status, setStatus] = useState<ActivePaneStatus | null>("working");
	return (
		<section style={{ padding: 28, maxWidth: 700, margin: "auto" }}>
			<h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>
				Session status
			</h1>
			<p style={{ color: "var(--muted-foreground)", marginBottom: 28 }}>
				Both agents use the same status. Only working animates.
			</p>
			<div
				style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 30 }}
			>
				{[
					["Codex", codex],
					["Claude", claude],
				].map(([label, icon]) => (
					<button
						type="button"
						key={label}
						aria-label={`${label}: ${labels[status ?? "idle"]}`}
						style={{
							display: "flex",
							alignItems: "center",
							gap: 14,
							padding: "14px 20px",
							border: "1px solid var(--border)",
							borderRadius: 13,
							background: "var(--card)",
						}}
					>
						<AgentStatusRing status={status}>
							<img src={icon} alt="" style={{ width: 18, height: 18 }} />
						</AgentStatusRing>
						{label}
					</button>
				))}
			</div>
			<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
				{statuses.map((s) => (
					<button
						type="button"
						key={s ?? "idle"}
						aria-pressed={status === s}
						onClick={() => setStatus(s)}
						style={{
							padding: "8px 12px",
							borderRadius: 8,
							border: "1px solid var(--border)",
							background: status === s ? "var(--accent)" : "transparent",
						}}
					>
						{labels[s ?? "idle"]}
					</button>
				))}
			</div>
			<output
				style={{
					display: "block",
					marginTop: 26,
					color: "var(--muted-foreground)",
				}}
			>
				{status === "working"
					? "Yellow ring breathes; the icon stays steady."
					: status === "permission"
						? "Red ring stays still while a question needs an answer."
						: status === "review"
							? "Green ring stays still after a completed response."
							: "Idle sessions have no ring."}
			</output>
		</section>
	);
}
createRoot(root).render(<Preview />);
