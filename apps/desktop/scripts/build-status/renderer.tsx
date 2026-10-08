import { Bot, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { TopBar } from "../../src/renderer/routes/_authenticated/_dashboard/components/TopBar/TopBar";
import type { BuildJob } from "../../src/shared/build-status";
import { draculaTheme } from "../../src/shared/themes/built-in/dracula";
import { HeaderPreviewTabs } from "./HeaderPreviewTabs";
import "../../src/renderer/globals.css";
import "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/WorkspaceToolPanels/tool-panels.css";

for (const [key, value] of Object.entries(draculaTheme.ui)) {
	if (typeof value === "string")
		document.documentElement.style.setProperty(
			`--${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`,
			value,
		);
}
document.documentElement.classList.add("dark");
document.documentElement.style.setProperty("--gs-pane-inset", "9px");
document.documentElement.style.setProperty(
	"--gs-pane-well",
	"var(--background)",
);
document.body.style.cssText =
	"margin:0;background:var(--background);color:var(--foreground);font-family:Inter,Segoe UI,sans-serif";
const root = document.createElement("main");
document.body.append(root);
const initial: BuildJob = {
	id: "public-30",
	version: "1.18.30",
	channel: "public",
	architectures: ["x64", "arm64"],
	sourceCommit: "33cc8dec0",
	stage: "ready",
	verified: true,
	published: true,
	message: "Both Windows installers are verified and available to download.",
	updatedAt: new Date().toISOString(),
	url: "https://github.com/yzgershon/GatedSpace/releases/tag/desktop-v1.18.30",
};

function Preview() {
	const [jobs, setJobs] = useState([initial]);
	const [opened, setOpened] = useState("");
	const [mounted, setMounted] = useState(false);
	useEffect(() => {
		setMounted(true);
	}, []);
	useEffect(() => {
		window.dispatchEvent(new CustomEvent("preview-builds", { detail: jobs }));
	}, [jobs]);
	useEffect(() => {
		const update = (event: Event) =>
			setJobs((event as CustomEvent<BuildJob[]>).detail);
		const open = (event: Event) =>
			setOpened((event as CustomEvent<string>).detail);
		const dismiss = (event: Event) =>
			setJobs((current) =>
				current.filter(
					(job) => job.id !== (event as CustomEvent<string>).detail,
				),
			);
		window.addEventListener("preview-builds", update);
		window.addEventListener("preview-open", open);
		window.addEventListener("preview-dismiss", dismiss);
		return () => {
			window.removeEventListener("preview-builds", update);
			window.removeEventListener("preview-open", open);
			window.removeEventListener("preview-dismiss", dismiss);
		};
	}, []);
	const presetsSlot = mounted
		? document.getElementById("workspace-topbar-presets-slot")
		: null;
	const tabsSlot = mounted
		? document.getElementById("workspace-topbar-tabs-slot")
		: null;
	return (
		<>
			<div className="workspace-topbar-layer">
				<TopBar />
			</div>
			{presetsSlot &&
				createPortal(
					<div
						className="flex min-w-0 shrink-0 items-center overflow-x-auto overflow-y-hidden h-[46px] gap-[3px] rounded-[13px] border border-border bg-muted/40 p-[3px]"
						style={{ scrollbarWidth: "none" }}
					>
						{["Codex", "Claude", "Gemini", "Copilot"].map((name, index) => (
							<div key={name} data-preset-index={index}>
								<button
									type="button"
									aria-label={name}
									className="h-10 shrink-0 px-3.5 text-[15px] text-muted-foreground"
									style={{ display: "flex", alignItems: "center", gap: 8 }}
								>
									<Bot
										size={20}
										style={{
											color: name === "Claude" ? "#d97757" : "#9386ff",
											flexShrink: 0,
										}}
									/>
									<span>{name}</span>
								</button>
							</div>
						))}
						<button
							type="button"
							aria-label="Manage presets"
							style={{ width: 30, flexShrink: 0 }}
						>
							<Settings size={16} />
						</button>
					</div>,
					presetsSlot,
				)}
			{tabsSlot && createPortal(<HeaderPreviewTabs />, tabsSlot)}
			{/* Include the positioned, painted workspace that sits below the real
			    header. A detached toolbar fixture cannot detect sibling occlusion. */}
			<div
				className="workspace-content-layer flex min-w-0 overflow-hidden"
				data-preview-workspace
			>
				<div
					className="gs-tool-workspace"
					style={
						{
							"--tool-right": "0px",
							"--tool-bottom": "0px",
						} as React.CSSProperties
					}
				>
					<div
						data-preview-pane
						style={{
							marginTop: "calc(var(--gs-pane-inset, 0px) * 2)",
							borderTop: "1px solid var(--border)",
							padding: 32,
							maxWidth: 660,
						}}
					>
						<small style={{ color: "var(--primary)" }}>
							INTERACTIVE PREVIEW
						</small>
						<h1 style={{ fontSize: 25, marginTop: 12 }}>
							Your builds stay in sight.
						</h1>
						<p
							style={{
								color: "var(--muted-foreground)",
								lineHeight: 1.8,
								marginTop: 12,
							}}
						>
							Click the build chip centered to the left of the agent launcher.
							Completed downloads and errors stay visible until dismissed. These
							controls simulate build states.
						</p>
						<div
							style={{
								display: "flex",
								gap: 12,
								flexWrap: "wrap",
								marginTop: 20,
							}}
						>
							{(["building", "verifying", "ready", "failed"] as const).map(
								(stage) => (
									<button
										key={stage}
										type="button"
										style={{
											border: "1px solid var(--border)",
											borderRadius: 8,
											padding: "8px 12px",
										}}
										onClick={() =>
											setJobs([
												{
													...initial,
													stage,
													message:
														stage === "failed"
															? "The build worker stopped before verification. Check the build log before retrying."
															: stage === "building"
																? "Packaging the Windows installers."
																: stage === "verifying"
																	? "Checking installer contents, architecture and checksums."
																	: initial.message,
												},
											])
										}
									>
										{stage}
									</button>
								),
							)}
						</div>
						{opened && <output aria-label="Opened URL">{opened}</output>}
					</div>
				</div>
			</div>
		</>
	);
}
createRoot(root).render(<Preview />);
