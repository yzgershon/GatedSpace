import {
	type RefObject,
	type TextareaHTMLAttributes,
	useCallback,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import "./session-composer.css";

/** Measure a hidden copy so resizing never collapses the live caret's viewport. */
export function GrowingTextarea({
	ref: forwarded,
	value,
	minRows = 2,
	onScroll,
	...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value"> & {
	ref?: RefObject<HTMLTextAreaElement | null>;
	value: string;
	minRows?: number;
}) {
	const local = useRef<HTMLTextAreaElement>(null);
	const input = forwarded ?? local;
	const mirror = useRef<HTMLTextAreaElement>(null);
	const [edges, setEdges] = useState({ above: false, below: false });
	const updateEdges = useCallback((node: HTMLTextAreaElement) => {
		const above = node.scrollTop > 2;
		const below = node.scrollHeight - node.clientHeight - node.scrollTop > 2;
		setEdges((old) =>
			old.above === above && old.below === below ? old : { above, below },
		);
	}, []);
	useLayoutEffect(() => {
		const node = input.current;
		const measure = mirror.current;
		if (!node || !measure) return;
		const resize = () => {
			const line = Number.parseFloat(getComputedStyle(node).lineHeight);
			measure.value = value || " ";
			node.style.height = `${Math.min(Math.max(line * minRows, measure.scrollHeight), line * 6.55)}px`;
			updateEdges(node);
		};
		resize();
		const observer = new ResizeObserver(resize);
		observer.observe(node.parentElement ?? node);
		return () => observer.disconnect();
	}, [value, input, updateEdges, minRows]);
	return (
		<div
			className="session-growing-input"
			data-above={edges.above}
			data-below={edges.below}
		>
			<textarea
				{...props}
				ref={input}
				value={value}
				rows={minRows}
				onScroll={(e) => {
					updateEdges(e.currentTarget);
					onScroll?.(e);
				}}
			/>
			<textarea
				ref={mirror}
				className="session-input-mirror"
				aria-hidden="true"
				tabIndex={-1}
				readOnly
				rows={1}
			/>
		</div>
	);
}
