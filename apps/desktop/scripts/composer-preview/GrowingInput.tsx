import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** Ten readable lines, then a fading peek at the next line. No prompt text is removed. */
export function GrowingInput({
	name,
	value,
	onChange,
}: {
	name: string;
	value: string;
	onChange: (value: string) => void;
}) {
	const input = useRef<HTMLTextAreaElement>(null);
	const [edges, setEdges] = useState({ above: false, below: false });
	const updateEdges = useCallback((node: HTMLTextAreaElement) => {
		const above = node.scrollTop > 2;
		const below = node.scrollHeight - node.clientHeight - node.scrollTop > 2;
		setEdges((old) =>
			old.above === above && old.below === below ? old : { above, below },
		);
	}, []);
	// A mirror measures wrapped lines without repeatedly collapsing the live input,
	// which would move the caret and scroll position while typing.
	const mirror = useRef<HTMLTextAreaElement>(null);
	useLayoutEffect(() => {
		const node = input.current;
		const measure = mirror.current;
		if (!node || !measure) return;
		const resize = () => {
			const line = Number.parseFloat(getComputedStyle(node).lineHeight);
			measure.value = value || " ";
			node.style.height = `${Math.min(Math.max(line * 2, measure.scrollHeight), line * 10 + line * 0.55)}px`;
			updateEdges(node);
		};
		resize();
		const observer = new ResizeObserver(resize);
		observer.observe(node.parentElement ?? node);
		return () => observer.disconnect();
	}, [value, updateEdges]);
	return (
		<div
			className="preview-growing-input"
			data-above={edges.above}
			data-below={edges.below}
		>
			<textarea
				ref={input}
				aria-label={`Message ${name}`}
				placeholder="Ask to make changes, /commands, or $skills…"
				value={value}
				rows={2}
				onChange={(e) => onChange(e.target.value)}
				onScroll={(e) => updateEdges(e.currentTarget)}
			/>
			<textarea
				ref={mirror}
				className="preview-input-mirror"
				aria-hidden="true"
				tabIndex={-1}
				readOnly
				rows={1}
			/>
		</div>
	);
}
