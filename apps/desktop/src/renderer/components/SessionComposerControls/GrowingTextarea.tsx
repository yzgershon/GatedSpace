import {
	type RefObject,
	type TextareaHTMLAttributes,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { useChatPreferencesStore } from "renderer/stores/chat-preferences";
import { getAutocorrection } from "./autocorrect";
import {
	spellingSuggestions,
	warmAutocorrectDictionary,
} from "./autocorrect-dictionary-loader";
import "./session-composer.css";

/** Measure a hidden copy so resizing never collapses the live caret's viewport. */
export function GrowingTextarea({
	ref: forwarded,
	value,
	minRows = 2,
	onScroll,
	onKeyDown,
	onInput,
	onBlur,
	onPointerDown,
	...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value"> & {
	ref?: RefObject<HTMLTextAreaElement | null>;
	value: string;
	minRows?: number;
}) {
	const local = useRef<HTMLTextAreaElement>(null);
	const input = forwarded ?? local;
	const mirror = useRef<HTMLTextAreaElement>(null);
	const autocorrect = useChatPreferencesStore((state) => state.autocorrect);
	useEffect(() => {
		if (autocorrect) void warmAutocorrectDictionary();
	}, [autocorrect]);
	const correction = useRef<{
		value: string;
		caret: number;
		typedCaret: number;
	} | null>(null);
	const keepTyped = useRef<{ value: string; caret: number } | null>(null);
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
				spellCheck={true}
				{...props}
				ref={input}
				value={value}
				rows={minRows}
				onBlur={(event) => {
					correction.current = null;
					keepTyped.current = null;
					onBlur?.(event);
				}}
				onPointerDown={(event) => {
					correction.current = null;
					keepTyped.current = null;
					onPointerDown?.(event);
				}}
				onInput={(event) => {
					const native = event.nativeEvent as InputEvent;
					if (
						native.inputType === "insertFromPaste" ||
						native.inputType === "insertFromDrop" ||
						native.isComposing ||
						(native.data?.length ?? 0) > 1
					) {
						keepTyped.current = {
							value: event.currentTarget.value,
							caret: event.currentTarget.selectionStart,
						};
					}
					onInput?.(event);
				}}
				onKeyDown={(event) => {
					const node = event.currentTarget;
					if (event.nativeEvent.isComposing || event.key === "Process") {
						correction.current = null;
						onKeyDown?.(event);
						return;
					}
					// Restore the typed word with one Backspace immediately after a
					// correction. Ctrl/Cmd+Z uses Chromium's ordinary undo history.
					if (
						((event.key === "Backspace" && !event.ctrlKey && !event.metaKey) ||
							(event.key.toLowerCase() === "z" &&
								(event.ctrlKey || event.metaKey) &&
								!event.shiftKey)) &&
						correction.current?.value === node.value &&
						correction.current.caret === node.selectionStart &&
						node.selectionStart === node.selectionEnd
					) {
						event.preventDefault();
						const typedCaret = correction.current.typedCaret;
						document.execCommand("undo");
						node.setSelectionRange(typedCaret, typedCaret);
						keepTyped.current = {
							value: node.value,
							caret: node.selectionStart,
						};
						correction.current = null;
						return;
					}
					correction.current = null;
					onKeyDown?.(event);
					if (
						event.defaultPrevented ||
						!autocorrect ||
						node.readOnly ||
						!node.spellcheck ||
						event.ctrlKey ||
						event.metaKey ||
						event.altKey ||
						!/^[ ,!?;:]$/.test(event.key) ||
						node.selectionStart !== node.selectionEnd
					)
						return;
					const caret = node.selectionStart;
					if (
						keepTyped.current?.value === node.value &&
						keepTyped.current.caret === caret
					) {
						keepTyped.current = null;
						return;
					}
					keepTyped.current = null;
					const change = getAutocorrection(
						node.value,
						caret,
						spellingSuggestions,
					);
					if (!change) return;
					node.setSelectionRange(change.start, caret);
					// A native editing transaction preserves React's onChange and the
					// undo stack; assigning textarea.value would discard both.
					if (
						document.execCommand(
							"insertText",
							false,
							change.replacement + event.key,
						)
					) {
						event.preventDefault();
						correction.current = {
							value: node.value,
							caret: node.selectionStart,
							typedCaret: caret,
						};
					} else node.setSelectionRange(caret, caret);
				}}
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
				spellCheck={false}
				rows={1}
			/>
		</div>
	);
}
