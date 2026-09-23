import {
	ArrowUp,
	ClipboardList,
	Code,
	Hand,
	Paperclip,
	Square,
	Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	type ClaudeAccount,
	useClaudeAccounts,
} from "renderer/components/ClaudeAccountSwap";
import { ComposerImage } from "renderer/components/SessionComposerControls/ComposerImage";
import { GrowingTextarea } from "renderer/components/SessionComposerControls/GrowingTextarea";
import { SessionComposerSettings } from "renderer/components/SessionComposerControls/SessionComposerSettings";
import {
	matchSwapCandidate,
	parseSwapCommand,
} from "shared/claude-account/swap-command";
import type { UserImagePayload } from "shared/claude-session/events";
import type { SessionStatus } from "shared/claude-session/timeline";
import { prepareImage } from "./composer-images";
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

export interface FileMention {
	name: string;
	relativePath: string;
}

interface SessionComposerProps {
	model?: string;
	fast?: boolean;
	onFastChange?: (fast: boolean) => Promise<void>;
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
	 * `/swap`: move this conversation onto another Claude account. Absent just
	 * removes the command — the palette then has nothing to offer for it.
	 */
	onSwapAccount?: (account: ClaudeAccount) => void;
	/** Which account this pane is pinned to, if it has been swapped. */
	pinnedAccountId?: string | null;
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

const MODEL_CHOICES: { id: string; label: string; description: string }[] = [
	{
		id: "default",
		label: "Default",
		description: "Whatever the CLI is configured to use",
	},
	{ id: "opus", label: "Opus", description: "Most capable, slowest" },
	{
		id: "sonnet",
		label: "Sonnet",
		description: "Balanced speed and capability",
	},
	{ id: "haiku", label: "Haiku", description: "Fastest, for simple work" },
	{
		id: "opusplan",
		label: "Opus Plan",
		description: "Opus for planning, Sonnet to execute",
	},
];

export function SessionComposer({
	model = "Claude",
	fast = false,
	onFastChange,
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
	onSwapAccount,
	pinnedAccountId,
	draftKey,
}: SessionComposerProps) {
	// Seeded from the module store, so reopening the tab finds the prompt still
	// there. The initialiser runs once per mount, which is exactly the moment to
	// restore it.
	const [text, setText] = useState(() =>
		draftKey ? getSessionDraft(draftKey).text : "",
	);
	const [settingsBusy, setSettingsBusy] = useState(false);
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
	 * Attach anything, by two different routes.
	 *
	 * IMAGES ride in the message as base64 blocks, because that is the only way
	 * the model can look at a picture, and it is verified to work (transport.ts).
	 *
	 * EVERYTHING ELSE goes in as an absolute PATH, and the model reads it off
	 * disk with its own tools. That is deliberate, not a shortcut. The CLI's
	 * stream-json input is not known to accept `document` blocks, and inventing
	 * one that gets silently dropped would look exactly like the model ignoring
	 * a PDF. Reading from disk is how the CLI already handles files, it works
	 * for anything it can open — pdf, csv, source, logs — and it costs nothing
	 * in message size, which matters when the file is 40MB.
	 *
	 * Decoding and downscaling images happens in the background, appending as
	 * each finishes. Failures are named rather than swallowed: a screenshot that
	 * silently didn't attach looks exactly like the model ignoring it.
	 */
	const attachFiles = (files: File[]) => {
		if (files.length === 0) return;
		setImageError(null);

		const images = files.filter((f) => f.type.startsWith("image/"));
		const others = files.filter((f) => !f.type.startsWith("image/"));

		for (const [index, file] of images.entries()) {
			void prepareImage(file, index)
				.then((image) => setImages((current) => [...current, image]))
				.catch((error: unknown) => {
					setImageError(
						error instanceof Error ? error.message : "Could not attach image",
					);
				});
		}

		if (others.length === 0) return;
		const paths: string[] = [];
		const unresolved: string[] = [];
		for (const file of others) {
			// Electron 32 dropped File.path; webUtils is the supported replacement
			// and is already on the preload surface. A file with no real path on
			// disk (a synthetic blob) cannot be read by the CLI, so say so rather
			// than attach a name that resolves to nothing.
			const path = window.webUtils?.getPathForFile(file);
			if (path) paths.push(path);
			else unresolved.push(file.name);
		}
		if (unresolved.length > 0) {
			setImageError(
				`Could not resolve a file path for ${unresolved.join(", ")} — save it to disk first.`,
			);
		}
		if (paths.length === 0) return;
		// Appended to the prompt rather than shown as a chip: the path IS the
		// instruction here, and the user can see and edit exactly what the model
		// will be told to read.
		setText((current) => {
			const separator = current.trim() ? "\n\n" : "";
			return `${current}${separator}${paths.join("\n")}`;
		});
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
	/*
	 * The accounts list, owned here rather than inside the palette.
	 *
	 * Enter must be able to resolve `/swap amitai` without the list ever being
	 * clicked, so the composer needs the same names the panel is showing — two
	 * fetches could disagree about which account a word refers to, and picking
	 * the wrong account is the one outcome this whole feature exists to prevent.
	 */
	const swapCommand = parseSwapCommand(text);
	const accounts = useClaudeAccounts(
		Boolean(swapCommand) && Boolean(onSwapAccount),
	);

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

	const submit = () => {
		const value = text.trim();
		/*
		 * `/swap` never reaches the CLI, which has no such command and would
		 * answer with an error. Enter picks the account when the name is
		 * unambiguous; a bare `/swap`, or a name that matches two accounts, leaves
		 * the text alone so the panel above stays open and the choice is made by
		 * clicking. Guessing between two accounts would be worse than asking.
		 */
		const swap = parseSwapCommand(value);
		if (swap && onSwapAccount) {
			const picked = matchSwapCandidate(accounts.accounts, swap.query);
			if (picked) {
				onSwapAccount(picked);
				setText("");
			}
			return;
		}
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
		<div className="session-composer-area">
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
					const files = Array.from(e.dataTransfer.files ?? []);
					if (files.length === 0) return;
					e.preventDefault();
					setDragging(false);
					attachFiles(files);
				}}
				className="session-composer"
				data-dragging={dragging}
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
						onSwapAccount={onSwapAccount}
						accounts={accounts}
						pinnedAccountId={pinnedAccountId}
						builtins={{
							effortLabel: EFFORT_LABELS[effort],
							accountLabel: accounts.accounts.find(
								(a) => a.id === (pinnedAccountId ?? accounts.activeId),
							)?.label,
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
							swapAccount: () => setText("/swap"),
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

				{images.length > 0 && (
					<fieldset className="session-images" aria-label="Attached images">
						{images.map((image, index) => (
							<ComposerImage
								key={`${image.name}:${index}`}
								name={image.name}
								source={`data:${image.mediaType};base64,${image.data}`}
								onRemove={() =>
									setImages((current) => current.filter((_, i) => i !== index))
								}
							/>
						))}
					</fieldset>
				)}
				{imageError && (
					<p
						className="px-4 pt-3 text-xs text-destructive select-text cursor-text"
						role="alert"
					>
						{imageError}
					</p>
				)}

				<div className="session-input">
					<span aria-hidden="true">›</span>
					<GrowingTextarea
						ref={textareaRef}
						value={text}
						onPaste={(e) => {
							// Screenshots come in as clipboard FILES, not text, and a file
							// copied in Explorer arrives the same way. Claim the paste only
							// when there are files AND no text: some apps put both on the
							// clipboard, and there the text is what the user meant.
							const files = Array.from(e.clipboardData?.files ?? []);
							if (files.length === 0) return;
							if (e.clipboardData?.getData("text/plain")) return;
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
						onKeyDown={(e) => {
							if (e.nativeEvent.isComposing) return;
							// Shift+Tab cycles modes — the popup advertises it, and reaching for
							// the mouse to change mode mid-thought is what it's avoiding.
							if (e.key === "Tab" && e.shiftKey && mentions.length === 0) {
								e.preventDefault();
								onModeChange(nextMode(mode));
								return;
							}
							// Tab or Enter takes the top file while the picker is open, so a
							// mention completes without reaching for the mouse.
							if (
								mentions.length > 0 &&
								(e.key === "Tab" || e.key === "Enter")
							) {
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
						aria-label="Message Claude"
						placeholder={
							isRunning
								? "Queue another message…"
								: "Ask to make changes, @files, or /commands…"
						}
					/>
				</div>
				<input
					ref={fileInputRef}
					type="file"
					// No accept filter. It used to be image/* which is why a PDF could
					// not be picked at all — the picker would not even show it.
					multiple
					className="hidden"
					onChange={(e) => {
						attachFiles(Array.from(e.target.files ?? []));
						// Clear it, or picking the same file twice in a row is a no-op.
						e.target.value = "";
					}}
				/>
				<div className="session-composer-toolbar">
					<button
						type="button"
						className="session-attach"
						aria-label="Attach a file"
						onClick={() => fileInputRef.current?.click()}
					>
						<Paperclip size={18} />
					</button>
					<SessionComposerSettings
						provider="Claude"
						model={model}
						models={MODEL_CHOICES.map((m) => ({
							id: m.id,
							name: m.id === "default" ? "Default model" : `Claude ${m.label}`,
						}))}
						onModelChange={
							onRunCommand
								? (id) => {
										setSettingsBusy(true);
										void onRunCommand(`/model ${id}`)
											.then((reply) => {
												if (!reply || !/set model to/i.test(reply))
													throw new Error(
														reply ||
															"Could not change the model. Wait for Claude to finish and retry.",
													);
												setImageError(null);
											})
											.catch((error: Error) => setImageError(error.message))
											.finally(() => setSettingsBusy(false));
									}
								: undefined
						}
						mode={mode}
						modes={[
							{
								id: "acceptEdits",
								label: "Auto",
								description: "Edit automatically; approve commands when needed",
							},
							{
								id: "plan",
								label: "Plan",
								description: "Think through the approach first",
								kind: "plan",
							},
							{
								id: "bypassPermissions",
								label: "Full access",
								description: "Work without approval prompts",
								kind: "full",
							},
							{
								id: "manual",
								label: "Manual",
								description: "Approve each edit and command",
							},
						]}
						onModeChange={(value) => onModeChange(value as SessionMode)}
						effort={effort}
						efforts={EFFORT_LEVELS}
						onEffortChange={(value) => onEffortChange(value as EffortLevel)}
						fast={fast}
						onFastChange={
							onFastChange
								? (value) => {
										setSettingsBusy(true);
										void onFastChange(value)
											.then(() => setImageError(null))
											.catch((error: Error) => setImageError(error.message))
											.finally(() => setSettingsBusy(false));
									}
								: undefined
						}
						disabled={isRunning || settingsBusy}
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
									className="session-send"
								>
									<ArrowUp className="size-4" />
								</button>
							) : null}
							<button
								type="button"
								onClick={onInterrupt}
								aria-label="Stop"
								className="session-send session-stop"
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
							className="session-send"
						>
							<ArrowUp className="size-4" />
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
