import { Button } from "@superset/ui/button";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LuX } from "react-icons/lu";

type Target = {
	kind: "agent" | "pane" | "composer" | "missing";
	rect: DOMRect | null;
	viewportWidth: number;
	viewportHeight: number;
	coachHeight: number;
};
export function WorkspaceTour({
	workspaceId,
	agent,
	onBack,
	onReturn,
	onFinish,
	onLater,
}: {
	workspaceId: string;
	agent: "claude" | "codex";
	onBack: () => void;
	onReturn: () => void;
	onFinish: () => void;
	onLater: () => void;
}) {
	const coach = useRef<HTMLElement>(null);
	const [target, setTarget] = useState<Target>({
		kind: "missing",
		rect: null,
		viewportWidth: window.innerWidth,
		viewportHeight: window.innerHeight,
		coachHeight: 240,
	});
	useEffect(() => {
		let frame = 0;
		const visible = (element: Element | null): element is HTMLElement =>
			element instanceof HTMLElement &&
			element.getBoundingClientRect().width > 0 &&
			element.getBoundingClientRect().height > 0;
		const measure = () => {
			frame = 0;
			const workspace = document.querySelector(
				`[data-workspace-preview="${CSS.escape(workspaceId)}"]`,
			);
			const composer = workspace?.querySelector(".session-composer") ?? null;
			const pane = document.querySelector("[data-first-run-pane]");
			const launch =
				workspace?.querySelector(`[data-first-run-agent*="${agent}"]`) ?? null;
			const element = visible(composer)
				? composer
				: visible(pane)
					? pane
					: visible(launch)
						? launch
						: null;
			const next: Target = {
				kind:
					element === composer && element
						? "composer"
						: element === pane && element
							? "pane"
							: element
								? "agent"
								: "missing",
				rect: element?.getBoundingClientRect() ?? null,
				viewportWidth: window.innerWidth,
				viewportHeight: window.innerHeight,
				coachHeight: coach.current?.getBoundingClientRect().height ?? 240,
			};
			setTarget((previous) =>
				previous.kind === next.kind &&
				previous.viewportWidth === next.viewportWidth &&
				previous.viewportHeight === next.viewportHeight &&
				previous.coachHeight === next.coachHeight &&
				JSON.stringify(previous.rect?.toJSON()) ===
					JSON.stringify(next.rect?.toJSON())
					? previous
					: next,
			);
		};
		const schedule = () => {
			if (!frame) frame = requestAnimationFrame(measure);
		};
		const observer = new MutationObserver(schedule);
		observer.observe(document.body, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["data-state", "hidden"],
		});
		const resize = new ResizeObserver(schedule);
		resize.observe(document.body);
		if (coach.current) resize.observe(coach.current);
		window.addEventListener("resize", schedule);
		window.addEventListener("scroll", schedule, true);
		measure();
		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
			resize.disconnect();
			window.removeEventListener("resize", schedule);
			window.removeEventListener("scroll", schedule, true);
		};
	}, [workspaceId, agent]);
	const name = agent === "codex" ? "Codex" : "Claude Code";
	const rect = target.rect;
	const width = Math.min(340, target.viewportWidth - 32);
	const left = rect
		? Math.max(
				16,
				Math.min(
					rect.left + (rect.width - width) / 2,
					target.viewportWidth - width - 16,
				),
			)
		: Math.max(16, (target.viewportWidth - width) / 2);
	const preferredTop = rect
		? rect.top >= target.coachHeight + 32
			? rect.top - target.coachHeight - 16
			: rect.bottom + 16
		: 96;
	const top = Math.max(
		16,
		Math.min(preferredTop, target.viewportHeight - target.coachHeight - 16),
	);
	return createPortal(
		<>
			{rect && (
				<div
					className="first-run-spotlight"
					style={{
						left: rect.left - 5,
						top: rect.top - 5,
						width: rect.width + 10,
						height: rect.height + 10,
					}}
				/>
			)}
			<section
				ref={coach}
				className="first-run-coach"
				style={{ left, top, width }}
				aria-label="First session guide"
				aria-live="polite"
			>
				<button
					type="button"
					className="first-run-coach-close"
					aria-label="Finish tour later"
					onClick={onLater}
				>
					<LuX />
				</button>
				<span className="text-xs text-muted-foreground">
					Getting started · 4 of 4
				</span>
				<h2>
					{target.kind === "composer"
						? "Your first conversation"
						: target.kind === "pane"
							? "Choose Session pane"
							: `Open ${name}`}
				</h2>
				<p>
					{target.kind === "composer"
						? "Click the message box and describe what you'd like to do. Add files with +, then press Enter to send. The agent works in your project folder and asks for approval when needed."
						: target.kind === "pane"
							? "Click the highlighted Session pane option. Your agent opens here with a readable conversation and its own controls."
							: target.kind === "agent"
								? `Click the highlighted ${name} button, then choose Session pane. You can add other agents beside it later.`
								: "Return to your project to start a session. If an agent needs attention, its setup controls will help you reconnect."}
				</p>
				<div className="flex gap-2 flex-wrap">
					<Button size="sm" variant="ghost" onClick={onBack}>
						Back to setup
					</Button>
					{target.kind === "composer" ? (
						<Button size="sm" onClick={onFinish}>
							Got it · start working
						</Button>
					) : target.kind === "missing" ? (
						<Button size="sm" onClick={onReturn}>
							Open my workspace
						</Button>
					) : null}
				</div>
			</section>
		</>,
		document.body,
	);
}
