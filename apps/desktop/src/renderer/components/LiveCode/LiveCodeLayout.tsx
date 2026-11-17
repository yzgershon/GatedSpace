import type { ReactNode } from "react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useLiveCodeState } from "./live-code-state";
import "./live-code.css";

const LiveCodePanel = lazy(() => import("./LiveCodePanel"));

export function LiveCodeLayout({
	paneId,
	workspaceId,
	provider,
	cwd,
	children,
}: {
	paneId: string;
	workspaceId: string;
	provider: "claude" | "codex";
	cwd?: string;
	children: ReactNode;
}) {
	const enabled = useLiveCodeState((s) => !!s.panes[paneId]);
	const [width, setWidth] = useState(380);
	const root = useRef<HTMLDivElement>(null);
	const drag = useRef(false);
	const pendingWidth = useRef(width);
	const frame = useRef(0);
	useEffect(() => () => cancelAnimationFrame(frame.current), []);
	const size = (next: number) => setWidth(Math.max(280, Math.min(600, next)));
	const finishDrag = () => {
		if (!drag.current) return;
		drag.current = false;
		cancelAnimationFrame(frame.current);
		frame.current = 0;
		root.current?.style.setProperty(
			"--live-chat-width",
			`${pendingWidth.current}px`,
		);
		size(pendingWidth.current);
	};
	return (
		<div
			className="gs-live-code-layout"
			data-enabled={enabled}
			ref={root}
			style={{ "--live-chat-width": `${width}px` } as React.CSSProperties}
		>
			{enabled && (
				<div className="gs-live-code-main">
					<Suspense
						fallback={
							<p className="p-6 text-sm text-muted-foreground">
								Opening live editor…
							</p>
						}
					>
						<LiveCodePanel
							paneId={paneId}
							workspaceId={workspaceId}
							provider={provider}
							cwd={cwd}
						/>
					</Suspense>
				</div>
			)}
			{enabled && (
				// biome-ignore lint/a11y/useSemanticElements: interactive splitter with a value range, not a static horizontal rule
				<div
					className="gs-live-code-divider"
					role="separator"
					aria-label="Resize live conversation"
					aria-orientation="vertical"
					aria-valuemin={280}
					aria-valuemax={600}
					aria-valuenow={width}
					tabIndex={0}
					onKeyDown={(event) => {
						if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
						event.preventDefault();
						size(width + (event.key === "ArrowLeft" ? 20 : -20));
					}}
					onPointerDown={(event) => {
						if (event.button !== 0) return;
						event.preventDefault();
						drag.current = true;
						pendingWidth.current = width;
						event.currentTarget.setPointerCapture(event.pointerId);
					}}
					onPointerMove={(event) => {
						if (!drag.current || !root.current) return;
						const rect = root.current.getBoundingClientRect();
						const scale = rect.width / root.current.offsetWidth || 1;
						pendingWidth.current = Math.max(
							280,
							Math.min(600, (rect.right - event.clientX) / scale),
						);
						if (!frame.current)
							frame.current = requestAnimationFrame(() => {
								frame.current = 0;
								root.current?.style.setProperty(
									"--live-chat-width",
									`${pendingWidth.current}px`,
								);
							});
					}}
					onPointerUp={finishDrag}
					onPointerCancel={finishDrag}
					onLostPointerCapture={finishDrag}
				>
					<span />
				</div>
			)}
			<div className="gs-live-code-conversation" key="conversation">
				{children}
			</div>
		</div>
	);
}
