import {
	bracketMatching,
	foldGutter,
	HighlightStyle,
	syntaxHighlighting,
} from "@codemirror/language";
import {
	Compartment,
	EditorState,
	StateEffect,
	StateField,
} from "@codemirror/state";
import {
	Decoration,
	EditorView,
	highlightActiveLineGutter,
	lineNumbers,
	WidgetType,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useRef } from "react";
import { loadLanguageSupport } from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/FilePane/registry/views/CodeView/components/CodeEditor/loadLanguageSupport";
import { detectLanguage } from "shared/detect-language";
import { codeReplacement } from "./live-code-files";

const changed = StateEffect.define<{ from: number; to: number }>();
const writing = StateEffect.define<number | null>();
class WritingCaret extends WidgetType {
	toDOM() {
		const caret = document.createElement("span");
		caret.className = "live-code-caret";
		caret.setAttribute("aria-hidden", "true");
		return caret;
	}
}
const caretField = StateField.define({
	create: () => Decoration.none,
	update(value, tr) {
		value = value.map(tr.changes);
		for (const effect of tr.effects)
			if (effect.is(writing))
				value =
					effect.value !== null
						? Decoration.set([
								Decoration.line({ class: "live-code-writing-line" }).range(
									tr.state.doc.lineAt(effect.value).from,
								),
								Decoration.widget({
									widget: new WritingCaret(),
									side: 1,
								}).range(effect.value),
							])
						: Decoration.none;
		return value;
	},
	provide: (field) => EditorView.decorations.from(field),
});
const lines = StateField.define({
	create: () => Decoration.none,
	update(value, tr) {
		value = value.map(tr.changes);
		for (const effect of tr.effects)
			if (effect.is(changed)) {
				const ranges = [];
				for (
					let line = effect.value.from;
					line <= Math.min(effect.value.to, tr.state.doc.lines);
					line++
				)
					if (line > 0)
						ranges.push(
							Decoration.line({ class: "live-code-added" }).range(
								tr.state.doc.line(line).from,
							),
						);
				value = Decoration.set(ranges);
			}
		return value;
	},
	provide: (field) => EditorView.decorations.from(field),
});
const highlight = HighlightStyle.define([
	{ tag: tags.keyword, color: "#ff79c6" },
	{ tag: [tags.string, tags.special(tags.string)], color: "#f1fa8c" },
	{ tag: [tags.number, tags.bool, tags.null], color: "#bd93f9" },
	{
		tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
		color: "#50fa7b",
	},
	{ tag: [tags.typeName, tags.className, tags.tagName], color: "#8be9fd" },
	{ tag: [tags.comment], color: "#9296b3", fontStyle: "italic" },
	{ tag: tags.attributeName, color: "#8be9fd" },
	{ tag: tags.operator, color: "#ff79c6" },
]);
export function LiveCodeSurface({
	code,
	path,
	animate,
	follow,
	animateInitial = false,
}: {
	code: string;
	path: string;
	animate: boolean;
	follow: boolean;
	animateInitial?: boolean;
}) {
	const language = detectLanguage(path);
	const languageCompartment = useRef(new Compartment()).current;
	const label = "Live file content";
	const initialized = useRef(false);
	const host = useRef<HTMLDivElement>(null);
	const editor = useRef<EditorView | null>(null);
	useEffect(() => {
		if (!host.current) return;
		const view = new EditorView({
			parent: host.current,
			state: EditorState.create({
				extensions: [
					lineNumbers(),
					foldGutter(),
					highlightActiveLineGutter(),
					bracketMatching(),
					lines,
					caretField,
					languageCompartment.of([]),
					syntaxHighlighting(highlight),
					EditorState.readOnly.of(true),
					EditorView.editable.of(false),
					EditorView.contentAttributes.of({ "aria-label": label }),
					EditorView.theme(
						{
							"&": {
								height: "100%",
								color: "var(--foreground)",
								backgroundColor: "var(--background)",
							},
							".cm-scroller": {
								fontFamily: "Cascadia Code, Consolas, monospace",
								fontSize: "12px",
								lineHeight: "1.85",
								overflow: "auto",
							},
							".cm-content": { padding: "16px 0 120px" },
							".cm-line": { padding: "0 20px 0 12px" },
							".cm-gutters": {
								backgroundColor: "var(--background)",
								color: "var(--muted-foreground)",
								border: "none",
								paddingLeft: "12px",
							},
							".cm-activeLineGutter": { backgroundColor: "transparent" },
							"&.cm-focused": { outline: "none" },
							".cm-selectionBackground": {
								backgroundColor: "#44475a !important",
							},
						},
						{ dark: true },
					),
				],
			}),
		});
		editor.current = view;
		return () => {
			view.destroy();
			editor.current = null;
		};
	}, [languageCompartment]);
	useEffect(() => {
		const view = editor.current;
		let disposed = false;
		void loadLanguageSupport(language)
			.then((support) => {
				if (!disposed && view && editor.current === view)
					view.dispatch({
						effects: languageCompartment.reconfigure(support ?? []),
					});
			})
			.catch(() => {});
		return () => {
			disposed = true;
		};
	}, [language, languageCompartment]);
	useEffect(() => {
		const view = editor.current;
		if (!view) return;
		let timer: ReturnType<typeof setInterval> | undefined;
		const previous = view.state.doc.toString();
		const edit = codeReplacement(previous, code);
		const addedFrom = code.slice(0, edit.from).split("\n").length;
		const apply = (text: string, caret: number | null) => {
			const current = view.state.doc.toString(),
				change = codeReplacement(current, text);
			view.dispatch({
				changes: { from: change.from, to: change.to, insert: change.insert },
				effects: [
					changed.of({
						from:
							!initialized.current && !animateInitial ? Infinity : addedFrom,
						to: code.slice(0, edit.from + edit.insert.length).split("\n")
							.length,
					}),
					writing.of(caret),
				],
			});
			if (follow)
				view.dispatch({
					effects: EditorView.scrollIntoView(caret ?? edit.from, {
						y: "nearest",
						yMargin: 65,
					}),
				});
		};
		const reduce = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;
		if (
			(!initialized.current && !animateInitial) ||
			!animate ||
			reduce ||
			document.hidden ||
			!edit.insert.length ||
			edit.insert.length > 32_768
		) {
			apply(code, null);
			initialized.current = true;
			return;
		}
		initialized.current = true;
		let count = 0;
		// Always catch up in at most 32 frames. A newer file snapshot replaces this
		// display job immediately; there is no backpressure on writes or the agent.
		const stride = Math.max(5, Math.ceil(edit.insert.length / 32));
		timer = setInterval(() => {
			count = Math.min(edit.insert.length, count + stride);
			const finished = count === edit.insert.length;
			apply(
				code.slice(0, edit.from) + edit.insert.slice(0, count) + edit.suffix,
				finished ? null : edit.from + count,
			);
			if (finished) clearInterval(timer);
		}, 24);
		return () => clearInterval(timer);
	}, [code, animate, animateInitial, follow]);

	return <div className="gs-live-code-surface" ref={host} />;
}
