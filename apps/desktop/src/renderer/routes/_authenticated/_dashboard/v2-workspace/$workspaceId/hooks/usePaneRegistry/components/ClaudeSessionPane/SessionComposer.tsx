/**
 * Composer for a Claude Code session pane.
 *
 * Presentational + controlled: the parent owns transport wiring and passes
 * callbacks. Shaped to match the VS Code Claude Code extension, which is the
 * reference Yish gave for this pane:
 *
 *  - A floating rounded card, not a docked bar. It overlays the timeline so the
 *    conversation keeps the full width behind it.
 *  - ONE popup holds mode and effort together. Two separate controls made a
 *    single decision ("how autonomous should this be") look like two.
 *  - Mode names are the extension's friendly ones over the CLI's
 *    default/acceptEdits/plan/bypassPermissions. The DESCRIPTIONS say what the
 *    CLI flag actually does, which for the last one is not what the extension
 *    claims — bypassPermissions never pauses for anything.
 *  - Shift+Tab cycles modes, because the popup says it does.
 *  - Effort: a real slider over 6 positions low→ultracode, draggable and
 *    keyboard-operable; "max" gets a rainbow knob and "ultracode"
 *    (= xhigh + workflows) glows purple.
 *  - NO mic. GatedVoice owns dictation, and a button that only looks like it
 *    listens is worse than no button.
 */
import { Popover, PopoverContent, PopoverTrigger } from "@superset/ui/popover";
import { cn } from "@superset/ui/utils";
import {
	ArrowUp,
	AtSign,
	Check,
	ClipboardList,
	Code,
	Hand,
	Plus,
	SlidersHorizontal,
	Square,
	SquareSlash,
	Zap,
} from "lucide-react";
import {
	type CSSProperties,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { UserImagePayload } from "shared/claude-session/events";
import type { SessionStatus } from "shared/claude-session/timeline";
import { imageFiles, prepareImage } from "./composer-images";
import { ImageChip } from "./ImageChip";
import { SlashPalette } from "./SlashPalette";
import {
	getSessionDraft,
	setSessionDraft,
	subscribeSessionDraft,
} from "./sessionStore";

export const EFFORT_LEVELS = [
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
	"ultracode",
] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/**
 * How each level is written for a human.
 *
 * The ids are what the CLI's `/effort` command takes, and one of them —
 * `xhigh` — is not a word. Capitalising the id produced "Xhigh", which reads as
 * a typo next to "Low" and "Medium".
 */
export const EFFORT_LABELS: Record<EffortLevel, string> = {
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "Extra high",
	max: "Max",
	ultracode: "Ultracode",
};

export const SESSION_MODES = [
	{
		id: "manual",
		label: "Manual",
		description: "Claude will ask for approval before making each edit",
		Icon: Hand,
	},
	{
		id: "acceptEdits",
		label: "Edit automatically",
		description: "Claude will apply file edits without asking first",
		Icon: Code,
	},
	{
		id: "plan",
		label: "Plan",
		description:
			"Claude will explore the code and present a plan before editing",
		Icon: ClipboardList,
	},
	{
		id: "bypassPermissions",
		label: "Auto",
		description: "Claude will run everything without asking. Nothing pauses",
		Icon: Zap,
	},
] as const;
export type SessionMode = (typeof SESSION_MODES)[number]["id"];

/** Grow with the text, but stop before the composer eats the conversation. */
const TEXTAREA_MAX_HEIGHT = 200;

/**
 * The composer's accent follows the THEME.
 *
 * These were literal hex — Claude's orange, sampled from the reference UI — on
 * the argument that the send button belongs to the assistant rather than to the
 * editor around it. Living with several themes settled it the other way: in
 * Dracula and Koi the ring around the focused box and the send arrow stayed
 * orange while every other accent in the window changed, so the one control you
 * look at most was the one thing that never matched.
 *
 * `primary` is the token every theme defines as its accent, so this now shifts
 * with the rest of the app and needs no per-theme handling.
 */
const SEND_BUTTON =
	"bg-primary text-primary-foreground hover:bg-primary/90 transition-colors";

export interface FileMention {
	name: string;
	relativePath: string;
}

interface SessionComposerProps {
	status: SessionStatus;
	slashCommands: string[];
	mode: SessionMode;
	effort: EffortLevel;
	onSend: (text: string, images?: UserImagePayload[]) => void;
	onInterrupt: () => void;
	onModeChange: (mode: SessionMode) => void;
	onEffortChange: (effort: EffortLevel) => void;
	/**
	 * Resolve an @mention query to workspace files. Leaving it out just disables
	 * the picker — typing a path by hand still works, because the CLI reads
	 * @paths out of the prompt text itself.
	 */
	onSearchFiles?: (query: string) => Promise<FileMention[]>;
	/**
	 * Run a local slash command in the live session and return its raw reply.
	 * Absent just means the palette shows plain completions with no panels.
	 */
	onRunCommand?: (command: string) => Promise<string | null>;
	/**
	 * Pane id, used to keep what's been typed alive across unmounts. Without it
	 * the draft is component state and dies on a tab switch — see sessionStore.
	 */
	draftKey?: string;
}

/** The @token being typed at the caret, if the caret is inside one. */
export function activeMention(
	text: string,
	caret: number,
): { query: string; start: number } | null {
	const before = text.slice(0, caret);
	const at = before.lastIndexOf("@");
	if (at === -1) return null;
	// An @ mid-word is an email or a decorator, not a mention; whitespace inside
	// the token means the mention already ended.
	if (at > 0 && !/\s/.test(before[at - 1] ?? "")) return null;
	const query = before.slice(at + 1);
	if (/\s/.test(query)) return null;
	return { query, start: at };
}

/** The next mode in the list, wrapping — what Shift+Tab steps through. */
export function nextMode(mode: SessionMode): SessionMode {
	const index = SESSION_MODES.findIndex((m) => m.id === mode);
	const next = SESSION_MODES[(index + 1) % SESSION_MODES.length];
	return next?.id ?? "manual";
}

/**
 * Effort as an actual slider.
 *
 * This was a row of six buttons drawn as dots. It LOOKED like a slider and
 * behaved like a radio group: you could click a position but not drag to one,
 * which is the specific gap between something that resembles a control and
 * something that is one.
 *
 * A real `input[type=range]` rather than pointer handlers on a div. Dragging,
 * clicking anywhere on the track, arrow keys, Home/End and the right
 * screen-reader semantics are all inherent to the element; rebuilding them by
 * hand is how the previous version ended up click-only.
 *
 * The knob takes the accent at the top of the scale, because ultracode needs an
 * xhigh-capable model and turns on orchestration — it is not simply "more", so
 * it should not look like simply the far end. Colours are theme tokens
 * throughout: earlier versions pinned literal purple and stayed purple in every
 * theme.
 */
function EffortSlider({
	effort,
	onChange,
}: {
	effort: EffortLevel;
	onChange: (e: EffortLevel) => void;
}) {
	const activeIndex = Math.max(0, EFFORT_LEVELS.indexOf(effort));
	const lastIndex = EFFORT_LEVELS.length - 1;
	const isUltracode = effort === "ultracode";

	return (
		<div
			className={cn(
				// The capsule IS the track. The input on top is transparent apart
				// from its knob, so the two cannot drift out of alignment the way a
				// separately-drawn bar would.
				"effort-track relative flex h-5 w-[92px] items-center rounded-full",
				isUltracode && "animate-ultracode-glow",
			)}
		>
			{EFFORT_LEVELS.map((level, index) => (
				<span
					key={level}
					aria-hidden="true"
					className="effort-tick"
					data-top={level === "ultracode"}
					// A fraction, not a percentage: the CSS multiplies it by the
					// knob-adjusted width, which is the only span the knob can cover.
					style={{ "--effort-tick-at": index / lastIndex } as CSSProperties}
				/>
			))}
			<input
				type="range"
				min={0}
				max={lastIndex}
				step={1}
				value={activeIndex}
				onChange={(event) => {
					const next = EFFORT_LEVELS[Number(event.target.value)];
					if (next) onChange(next);
				}}
				// Named and described for assistive tech as the scale it is, rather
				// than as a bare number between 0 and 5.
				aria-label="Effort"
				aria-valuetext={EFFORT_LABELS[effort]}
				title={EFFORT_LABELS[effort]}
				data-top={isUltracode}
				data-rainbow={effort === "max"}
				className="effort-slider relative"
			/>
		</div>
	);
}

/**
 * Mode picker and effort in one popup.
 *
 * Effort lives at the bottom of the same sheet rather than in a control of its
 * own: both answer "how much should Claude do on its own", and splitting them
 * meant reading two widgets to know one thing.
 */
function ModesPopover({
	mode,
	effort,
	onModeChange,
	onEffortChange,
}: {
	mode: SessionMode;
	effort: EffortLevel;
	onModeChange: (mode: SessionMode) => void;
	onEffortChange: (effort: EffortLevel) => void;
}) {
	const active = SESSION_MODES.find((m) => m.id === mode) ?? SESSION_MODES[0];
	const ActiveIcon = active.Icon;

	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label="Mode and effort"
					className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
				>
					<ActiveIcon className="size-3.5" />
					{active.label}
				</button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				side="top"
				sideOffset={8}
				className="w-[26rem] p-0"
			>
				<div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
					<span className="text-[12.5px] text-muted-foreground">Modes</span>
					<span className="flex items-center gap-1 text-[11px] text-muted-foreground/60">
						<kbd className="rounded border border-border bg-tertiary px-1 py-px font-sans text-[10px]">
							⇧
						</kbd>
						+
						<kbd className="rounded border border-border bg-tertiary px-1 py-px font-sans text-[10px]">
							tab
						</kbd>
						to switch
					</span>
				</div>
				<div className="flex flex-col px-1 pb-1">
					{SESSION_MODES.map((m) => {
						const Icon = m.Icon;
						const selected = m.id === mode;
						return (
							<button
								key={m.id}
								type="button"
								onClick={() => onModeChange(m.id)}
								className={cn(
									"flex items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors focus-visible:outline-none",
									selected ? "bg-accent" : "hover:bg-accent/50",
								)}
							>
								<Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
								<span className="min-w-0 flex-1">
									<span className="block text-[13px] text-foreground">
										{m.label}
									</span>
									<span className="block text-[12px] text-muted-foreground/80">
										{m.description}
									</span>
								</span>
								{selected ? (
									<Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
								) : null}
							</button>
						);
					})}
				</div>
				<div className="flex items-center gap-2.5 border-border/60 border-t px-3 py-2">
					<SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" />
					<span className="text-[13px] text-foreground">
						Effort{" "}
						<span className="text-muted-foreground/80">
							({EFFORT_LABELS[effort]})
						</span>
					</span>
					<div className="flex-1" />
					<EffortSlider effort={effort} onChange={onEffortChange} />
				</div>
			</PopoverContent>
		</Popover>
	);
}

/** A small square icon button on the composer's bottom row. */
function IconButton({
	label,
	onClick,
	children,
}: {
	label: string;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			onClick={onClick}
			className="flex size-7 items-center justify-center rounded-md text-foreground/75 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
		>
			{children}
		</button>
	);
}

export function SessionComposer({
	status,
	slashCommands,
	mode,
	effort,
	onSend,
	onInterrupt,
	onModeChange,
	onEffortChange,
	onSearchFiles,
	onRunCommand,
	draftKey,
}: SessionComposerProps) {
	// Seeded from the module store, so reopening the tab finds the prompt still
	// there. The initialiser runs once per mount, which is exactly the moment to
	// restore it.
	const [text, setText] = useState(() =>
		draftKey ? getSessionDraft(draftKey).text : "",
	);
	const [focused, setFocused] = useState(false);
	const [caret, setCaret] = useState(0);
	const [mentions, setMentions] = useState<FileMention[]>([]);
	const [images, setImages] = useState<UserImagePayload[]>(() =>
		draftKey ? getSessionDraft(draftKey).images : [],
	);
	const [imageError, setImageError] = useState<string | null>(null);
	const [dragging, setDragging] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const isRunning = status === "streaming";

	/**
	 * Decode and downscale in the background, appending as each finishes. Failures
	 * are named rather than swallowed: a screenshot that silently didn't attach
	 * looks exactly like the model ignoring it.
	 */
	const attachFiles = (files: File[]) => {
		if (files.length === 0) return;
		setImageError(null);
		for (const [index, file] of files.entries()) {
			void prepareImage(file, index)
				.then((image) => setImages((current) => [...current, image]))
				.catch((error: unknown) => {
					setImageError(
						error instanceof Error ? error.message : "Could not attach image",
					);
				});
		}
	};

	// Mirror the draft out to the module store on every change, so an unmount
	// mid-sentence loses nothing. Cheap: two references into a Map.
	useEffect(() => {
		if (!draftKey) return;
		setSessionDraft(draftKey, { text, images });
	}, [draftKey, text, images]);

	// Pick up attachments added from OUTSIDE this component — a captured browser
	// pane being sent here. `setSessionDraft` above deliberately does not notify,
	// so the mirror effect cannot feed this back and loop; only an external
	// attach does.
	useEffect(() => {
		if (!draftKey) return;
		return subscribeSessionDraft(draftKey, () => {
			setImages(getSessionDraft(draftKey).images);
		});
	}, [draftKey]);

	const showPalette = text.startsWith("/");

	const mention = useMemo(() => activeMention(text, caret), [text, caret]);

	// Search on the token as it's typed. The guard tracks the latest query so a
	// slow response for an older token can't overwrite a newer one's results.
	useEffect(() => {
		if (!onSearchFiles || !mention) {
			setMentions([]);
			return;
		}
		let current = true;
		void onSearchFiles(mention.query)
			.then((files) => {
				if (current) setMentions(files.slice(0, 8));
			})
			.catch(() => {
				if (current) setMentions([]);
			});
		return () => {
			current = false;
		};
	}, [onSearchFiles, mention]);

	// Grow to fit what's typed. No dependency list: every render is a moment the
	// text may have changed, and writing the same height back is a no-op.
	useEffect(() => {
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
	});

	// Ctrl+Esc puts the caret here from anywhere, and takes it back out — the
	// placeholder promises it, so it has to be real. With more than one session
	// pane open the last one mounted answers; that's a fair reading of "focus
	// Claude" when only one composer can hold the caret anyway.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || !event.ctrlKey) return;
			const el = textareaRef.current;
			if (!el) return;
			event.preventDefault();
			if (document.activeElement === el) el.blur();
			else el.focus();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	const insertMention = (file: FileMention) => {
		if (!mention) return;
		const next = `${text.slice(0, mention.start)}@${file.relativePath} ${text.slice(caret)}`;
		setText(next);
		setMentions([]);
		const position = mention.start + file.relativePath.length + 2;
		// Restore the caret after React writes the new value, or it jumps to the end.
		requestAnimationFrame(() => {
			const el = textareaRef.current;
			if (!el) return;
			el.focus();
			el.setSelectionRange(position, position);
			setCaret(position);
		});
	};

	/** Type a leading character for the user and open its picker. */
	const startWith = (char: string) => {
		const next = text.startsWith(char) ? text : `${char}${text}`;
		setText(next);
		requestAnimationFrame(() => {
			const el = textareaRef.current;
			if (!el) return;
			el.focus();
			el.setSelectionRange(next.length, next.length);
			setCaret(next.length);
		});
	};

	const submit = () => {
		const value = text.trim();
		// An image on its own is a complete prompt ("look at this"), so having
		// something attached is enough to send even with the box empty.
		if (!value && images.length === 0) return;
		onSend(value, images.length > 0 ? images : undefined);
		setText("");
		setMentions([]);
		setImages([]);
		setImageError(null);
	};

	const canSend = Boolean(text.trim()) || images.length > 0;

	return (
		// z-30 puts the composer above the pinned prompt (z-10) inside the
		// scroller. Without it a tall sticky prompt rendered over the box you type
		// into, and over the slash palette that opens from it.
		<div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-4">
			{/* biome-ignore lint/a11y/noStaticElementInteractions: a drop target is
			    a region, not a control; the same files go in via the + button,
			    which is the keyboard-reachable path. */}
			<div
				onDragOver={(e) => {
					// Only claim the drop for files, or dragging selected text within
					// the textarea would light up the whole composer.
					if (!e.dataTransfer.types.includes("Files")) return;
					e.preventDefault();
					setDragging(true);
				}}
				onDragLeave={(e) => {
					// Ignore the leave events fired while crossing child elements.
					if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
					setDragging(false);
				}}
				onDrop={(e) => {
					const files = imageFiles(e.dataTransfer.files);
					if (files.length === 0) return;
					e.preventDefault();
					setDragging(false);
					attachFiles(files);
				}}
				className={cn(
					"pointer-events-auto relative w-full max-w-3xl rounded-2xl border bg-card transition-[border-color,box-shadow]",
					/*
					 * The resting border used to be `transparent`, which is why this
					 * read flatter than the reference: the box had no edge of its own
					 * and leaned entirely on a soft shadow. It keeps a real edge now,
					 * on the theme's border token rather than a hardcoded white so it
					 * survives the light themes, plus a tighter, deeper shadow than
					 * shadow-lg — the box should sit ABOVE the conversation, and a
					 * diffuse shadow reads as haze rather than lift.
					 */
					dragging
						? "border-highlight shadow-[0_0_0_3px_color-mix(in_oklab,var(--highlight)_22%,transparent)]"
						: focused
							? "border-primary shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-primary)_12%,transparent),0_18px_40px_-12px_rgb(0_0_0/0.55)]"
							: "border-border shadow-[0_10px_30px_-12px_rgb(0_0_0/0.45),0_2px_6px_-2px_rgb(0_0_0/0.25)]",
				)}
			>
				{showPalette && onRunCommand ? (
					<SlashPalette
						text={text}
						commands={slashCommands}
						onRunCommand={onRunCommand}
						onPickCommand={(command) => setText(`/${command} `)}
						onPickModel={(id) => {
							// Applying the model is itself a local command, and the composer
							// shouldn't be left holding "/model" afterwards.
							void onRunCommand(`/model ${id}`);
							setText("");
						}}
						builtins={{
							effortLabel: EFFORT_LABELS[effort],
							attachFile: () => {
								setText("");
								fileInputRef.current?.click();
							},
							// Leave the "@" behind so the mention list opens on it, the
							// same as clicking the button in the bar.
							mentionFile: () => setText("@"),
							// These two open the palette's own panels, which is what
							// typing the command by hand already does.
							switchModel: () => setText("/model"),
							accountUsage: () => setText("/usage"),
						}}
					/>
				) : null}

				{mentions.length > 0 ? (
					<div className="absolute bottom-full left-0 mb-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-md">
						{mentions.map((file) => (
							<button
								key={file.relativePath}
								type="button"
								// The textarea blurs before a click lands, which would close
								// this first — take the insert on mousedown instead.
								onMouseDown={(e) => {
									e.preventDefault();
									insertMention(file);
								}}
								className="flex w-full items-baseline gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-accent"
							>
								<span className="shrink-0 text-foreground">{file.name}</span>
								<span className="truncate font-mono text-[11px] text-muted-foreground">
									{file.relativePath}
								</span>
							</button>
						))}
					</div>
				) : null}

				{images.length > 0 || imageError ? (
					<div className="flex flex-wrap items-center gap-1.5 px-3 pt-3">
						{images.map((image, index) => (
							<ImageChip
								key={`${image.name}-${index}`}
								attachment={image}
								// Row height here: you just picked the image, so a preview
								// tile shows you what you are already looking at and takes
								// the height out of the conversation to do it.
								compact
								// The composer still holds the full payload, so expanding here
								// shows what will actually be sent rather than the preview.
								fullSource={`data:${image.mediaType};base64,${image.data}`}
								onRemove={() =>
									setImages((current) => current.filter((_, i) => i !== index))
								}
							/>
						))}
						{imageError ? (
							<span className="text-[11.5px] text-destructive">
								{imageError}
							</span>
						) : null}
					</div>
				) : null}

				<textarea
					ref={textareaRef}
					value={text}
					onPaste={(e) => {
						// Screenshots come in as clipboard FILES, not text. Claim the
						// paste only when there's an image, so pasting text still works.
						const files = imageFiles(e.clipboardData?.files);
						if (files.length === 0) return;
						e.preventDefault();
						attachFiles(files);
					}}
					onChange={(e) => {
						setText(e.target.value);
						setCaret(e.target.selectionStart ?? e.target.value.length);
					}}
					onSelect={(e) =>
						setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)
					}
					onFocus={() => setFocused(true)}
					onBlur={() => setFocused(false)}
					onKeyDown={(e) => {
						// Shift+Tab cycles modes — the popup advertises it, and reaching for
						// the mouse to change mode mid-thought is what it's avoiding.
						if (e.key === "Tab" && e.shiftKey && mentions.length === 0) {
							e.preventDefault();
							onModeChange(nextMode(mode));
							return;
						}
						// Tab or Enter takes the top file while the picker is open, so a
						// mention completes without reaching for the mouse.
						if (mentions.length > 0 && (e.key === "Tab" || e.key === "Enter")) {
							e.preventDefault();
							const first = mentions[0];
							if (first) insertMention(first);
							return;
						}
						if (e.key === "Escape" && mentions.length > 0) {
							e.preventDefault();
							setMentions([]);
							return;
						}
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							submit();
						}
					}}
					rows={1}
					placeholder={
						isRunning
							? "Queue another message…"
							: "ctrl esc to focus or unfocus Claude"
					}
					className="w-full resize-none bg-transparent px-4 pt-3.5 pb-2.5 text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground/50"
				/>

				{/*
				 * A hairline between what you type and the controls under it, the
				 * way VS Code's composer draws it.
				 *
				 * Deliberately faint — at /50 of the border token it reads as a
				 * change of surface rather than as a rule, which is the point: it
				 * should separate the two halves without becoming another line to
				 * look at. Edge to edge rather than inset, so it reads as the
				 * composer being in two parts rather than as a stray divider.
				 *
				 * On the border token, so it follows the theme like everything else.
				 */}
				{/*
				 * Full-strength divider and 3px/4px padding, down from /50 and
				 * 8px/10px. At half opacity the rule was doing the job of a hint
				 * rather than a separation, and the padding made a 46px bar out of
				 * 28px icons — eleven pixels that belong to the conversation.
				 */}
				<div className="flex items-center gap-0.5 border-border border-t px-2.5 pt-[3px] pb-1">
					<input
						ref={fileInputRef}
						type="file"
						accept="image/*"
						multiple
						className="hidden"
						onChange={(e) => {
							attachFiles(imageFiles(e.target.files));
							// Clear it, or picking the same file twice in a row is a no-op.
							e.target.value = "";
						}}
					/>
					<IconButton
						label="Attach an image"
						onClick={() => fileInputRef.current?.click()}
					>
						<Plus className="size-4" />
					</IconButton>
					<IconButton label="Mention a file" onClick={() => startWith("@")}>
						<AtSign className="size-4" />
					</IconButton>
					<IconButton label="Run a command" onClick={() => startWith("/")}>
						<SquareSlash className="size-4" />
					</IconButton>

					<div className="flex-1" />

					<ModesPopover
						mode={mode}
						effort={effort}
						onModeChange={onModeChange}
						onEffortChange={onEffortChange}
					/>

					{isRunning ? (
						<>
							{/* Enter queues while a turn runs; without this the mouse had
							    no way to do the same, since Stop took the button's place. */}
							{canSend ? (
								<button
									type="button"
									onClick={submit}
									aria-label="Queue message"
									className={cn(
										"ml-1 flex size-8 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
										SEND_BUTTON,
									)}
								>
									<ArrowUp className="size-4" />
								</button>
							) : null}
							<button
								type="button"
								onClick={onInterrupt}
								aria-label="Stop"
								className="ml-1 flex size-8 items-center justify-center rounded-lg bg-foreground/10 text-foreground transition-colors hover:bg-foreground/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							>
								<Square className="size-3 fill-current" />
							</button>
						</>
					) : (
						<button
							type="button"
							onClick={submit}
							disabled={!canSend}
							aria-label="Send"
							className={cn(
								"ml-1 flex size-8 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
								canSend
									? SEND_BUTTON
									: "bg-foreground/10 text-muted-foreground",
							)}
						>
							<ArrowUp className="size-4" />
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
