import {
	type RefObject,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import type { PromptEntry } from "./prompts";
import "./prompt-navigator.css";

export function PromptNavigator({
	prompts,
	scrollRef,
	onNavigate,
	onEarlier,
	loadingEarlier = false,
}: {
	prompts: PromptEntry[];
	scrollRef: RefObject<HTMLElement | null>;
	onNavigate: () => void;
	onEarlier?: () => void;
	loadingEarlier?: boolean;
}) {
	const root = useRef<HTMLElement>(null);
	const list = useRef<HTMLDivElement>(null);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [preview, setPreview] = useState<{ id: string; top: number } | null>(
		null,
	);
	const previewId = useId();
	const activeIndex = Math.max(
		0,
		prompts.findIndex((p) => p.id === activeId),
	);
	const previewIndex = prompts.findIndex((p) => p.id === preview?.id);
	const entry = prompts[previewIndex];
	useLayoutEffect(() => {
		const viewport = scrollRef.current;
		if (!viewport || !prompts.length) return;
		const ids = new Set(prompts.map((p) => p.id));
		const targets = Array.from(
			viewport.querySelectorAll<HTMLElement>("[data-prompt-id]"),
		).filter((el) => ids.has(el.dataset.promptId ?? ""));
		let frame = 0;
		const measure = () => {
			const top = viewport.getBoundingClientRect().top;
			const edge = top + Math.min(100, viewport.clientHeight / 4);
			let current = targets[0]?.dataset.promptId ?? null;
			for (const target of targets) {
				if (target.getBoundingClientRect().top > edge) break;
				current = target.dataset.promptId ?? current;
			}
			if (
				viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <
				2
			)
				current = targets.at(-1)?.dataset.promptId ?? current;
			setActiveId(current);
		};
		const schedule = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(measure);
		};
		const observer = new ResizeObserver(schedule);
		observer.observe(viewport);
		if (viewport.firstElementChild)
			observer.observe(viewport.firstElementChild);
		viewport.addEventListener("scroll", schedule, { passive: true });
		measure();
		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
			viewport.removeEventListener("scroll", schedule);
		};
	}, [prompts, scrollRef]);
	useLayoutEffect(() => {
		// Only scroll the rail itself, never an ancestor transcript or pane.
		const rail = list.current;
		if (!rail || preview || !activeId) return;
		const mark = rail.querySelector<HTMLElement>('[aria-current="location"]');
		if (!mark) return;
		const offset =
			mark.getBoundingClientRect().top - rail.getBoundingClientRect().top;
		if (offset < 0 || offset + mark.offsetHeight > rail.clientHeight)
			rail.scrollTop += offset - rail.clientHeight / 2 + mark.offsetHeight / 2;
	}, [activeId, preview]);
	const showPreview = (id: string, button: HTMLElement) => {
		const bounds = root.current?.getBoundingClientRect();
		if (!bounds) return;
		setPreview({
			id,
			top: Math.max(
				0,
				Math.min(
					bounds.height - 190,
					button.getBoundingClientRect().top - bounds.top - 30,
				),
			),
		});
	};
	const jump = (id: string) => {
		const viewport = scrollRef.current;
		const target = Array.from(
			viewport?.querySelectorAll<HTMLElement>("[data-prompt-id]") ?? [],
		).find((el) => el.dataset.promptId === id);
		if (!viewport || !target) return;
		onNavigate();
		viewport.scrollTo({
			top:
				viewport.scrollTop +
				target.getBoundingClientRect().top -
				viewport.getBoundingClientRect().top -
				16,
			behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
				? "instant"
				: "smooth",
		});
	};
	if (!prompts.length) return null;
	return (
		<nav
			ref={root}
			className="prompt-navigator"
			aria-label="Prompt history"
			onPointerLeave={() => setPreview(null)}
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget))
					setPreview(null);
			}}
			onKeyDown={(event) => {
				if (event.key === "Escape") setPreview(null);
			}}
		>
			<div
				className="prompt-navigator-list"
				ref={list}
				onScroll={() => {
					const focused = document.activeElement as HTMLElement | null;
					if (focused?.dataset.promptTarget && list.current?.contains(focused))
						showPreview(focused.dataset.promptTarget, focused);
					else setPreview(null);
				}}
			>
				{onEarlier && (
					<button
						type="button"
						className="prompt-navigator-earlier"
						aria-label="Load earlier prompts"
						title="Load earlier prompts"
						disabled={loadingEarlier}
						onClick={onEarlier}
					>
						<span aria-hidden="true">{loadingEarlier ? "·" : "···"}</span>
					</button>
				)}
				{prompts.map((prompt, index) => (
					<button
						key={prompt.id}
						type="button"
						className="prompt-navigator-mark"
						aria-label={`Go to prompt ${index + 1}: ${prompt.text.slice(0, 100)}`}
						aria-current={index === activeIndex ? "location" : undefined}
						aria-describedby={preview?.id === prompt.id ? previewId : undefined}
						tabIndex={index === activeIndex ? 0 : -1}
						data-near={previewIndex >= 0 && Math.abs(previewIndex - index) <= 2}
						data-preview={preview?.id === prompt.id}
						data-prompt-target={prompt.id}
						onPointerEnter={(event) =>
							showPreview(prompt.id, event.currentTarget)
						}
						onFocus={(event) => showPreview(prompt.id, event.currentTarget)}
						onClick={() => jump(prompt.id)}
						onKeyDown={(event) => {
							if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key))
								return;
							event.preventDefault();
							const next =
								event.key === "Home"
									? 0
									: event.key === "End"
										? prompts.length - 1
										: Math.max(
												0,
												Math.min(
													prompts.length - 1,
													index + (event.key === "ArrowUp" ? -1 : 1),
												),
											);
							const button = list.current?.querySelectorAll<HTMLButtonElement>(
								".prompt-navigator-mark",
							)[next];
							button?.focus({ preventScroll: true });
							if (button && list.current) {
								const offset =
									button.getBoundingClientRect().top -
									list.current.getBoundingClientRect().top;
								if (
									offset < 0 ||
									offset > list.current.clientHeight - button.offsetHeight
								)
									list.current.scrollTop +=
										offset - list.current.clientHeight / 2;
								showPreview(prompts[next].id, button);
							}
						}}
					>
						<span aria-hidden="true" />
					</button>
				))}
			</div>
			{entry && preview && (
				<div
					id={previewId}
					role="tooltip"
					className="prompt-navigator-preview"
					style={{ top: preview.top }}
				>
					<div className="prompt-navigator-meta">
						Prompt {previewIndex + 1} of {prompts.length}
						{entry.imageCount
							? ` · ${entry.imageCount} image${entry.imageCount === 1 ? "" : "s"}`
							: ""}
					</div>
					<p className="prompt-navigator-title">{entry.text}</p>
					{entry.reply && (
						<p className="prompt-navigator-reply">{entry.reply}</p>
					)}
				</div>
			)}
		</nav>
	);
}
