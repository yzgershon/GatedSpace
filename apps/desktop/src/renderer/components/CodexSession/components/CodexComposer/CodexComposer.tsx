import { useQuery } from "@tanstack/react-query";
import { ArrowUp, Paperclip, Square, X } from "lucide-react";
import {
	type SetStateAction,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { ComposerImage } from "renderer/components/SessionComposerControls/ComposerImage";
import { GrowingTextarea } from "renderer/components/SessionComposerControls/GrowingTextarea";
import { SessionChangesPill } from "renderer/components/SessionComposerControls/SessionChangesPill";
import { SessionComposerSettings } from "renderer/components/SessionComposerControls/SessionComposerSettings";
import {
	getCodexDraft,
	subscribeCodexDraft,
	updateCodexDraft,
} from "renderer/lib/codex-session/draft";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { codexTaskChanges } from "shared/codex-session/changes";
import { defaultCodexEffort } from "shared/codex-session/controls";
import type {
	CodexModel,
	CodexPermission,
	CodexSessionState,
} from "shared/codex-session/types";
import { ComputerControl } from "../ComputerControl/ComputerControl";
import { CODEX_COMMANDS, parseCodexCommand } from "./commands";

export function CodexComposer({
	paneId,
	state,
	models,
	onError,
}: {
	paneId: string;
	state?: CodexSessionState;
	models: CodexModel[];
	onError: (error: string | null) => void;
}) {
	const saved = useSyncExternalStore(
		(fn) => subscribeCodexDraft(paneId, fn),
		() => getCodexDraft(paneId),
	);
	const draft = saved.text;
	const images = saved.images;
	const setDraft = (next: SetStateAction<string>) =>
		updateCodexDraft(paneId, {
			text:
				typeof next === "function" ? next(getCodexDraft(paneId).text) : next,
		});
	const setImages = (next: SetStateAction<typeof images>) =>
		updateCodexDraft(paneId, {
			images:
				typeof next === "function" ? next(getCodexDraft(paneId).images) : next,
		});
	const chosenModel = saved.model ?? "";
	const setChosenModel = (value: string) =>
		updateCodexDraft(paneId, { model: value });
	const chosenEffort = saved.effort ?? "";
	const setChosenEffort = (value: string) =>
		updateCodexDraft(paneId, { effort: value });
	const permission = saved.permission ?? "default";
	const setPermission = (value: CodexPermission) =>
		updateCodexDraft(paneId, { permission: value });
	const plan = saved.plan ?? false;
	const setPlan = (value: boolean) => updateCodexDraft(paneId, { plan: value });
	const fast = saved.fast ?? false;
	const setFast = (value: boolean) => updateCodexDraft(paneId, { fast: value });
	const [sending, setSending] = useState(false);
	const [notice, setNotice] = useState("");
	const [caret, setCaret] = useState(0);
	const [menuIndex, setMenuIndex] = useState(0);
	const [menuDismissed, setMenuDismissed] = useState(false);
	const skillQuery = useQuery({
		queryKey: ["native-codex-skills", state?.cwd],
		queryFn: () =>
			electronTrpcClient.codexSession.skills.query({ cwd: state?.cwd ?? "" }),
		enabled: Boolean(state?.cwd),
		staleTime: 60_000,
		retry: false,
	});
	const textarea = useRef<HTMLTextAreaElement>(null);
	const fileInput = useRef<HTMLInputElement>(null);
	const model = chosenModel || state?.model || models[0]?.id || "";
	const selected = models.find((m) => m.id === model);
	const effort = chosenEffort || state?.effort || defaultCodexEffort(selected);
	const working = state?.status === "working";
	const changes = useMemo(() => codexTaskChanges(state), [state]);
	const before = draft.slice(0, caret);
	const skillToken = before.match(/(?:^|\s)\$([\w.:-]*)$/);
	const slashToken = before.match(/^\/(\S*)$/);
	const command = parseCodexCommand(before);
	const options = menuDismissed
		? []
		: skillToken
			? (skillQuery.data ?? [])
					.filter((s) =>
						s.name.toLowerCase().includes(skillToken[1].toLowerCase()),
					)
					.map((s) => ({
						name: `$${s.name}`,
						description: s.description,
						insert: `$${s.name} `,
					}))
			: slashToken
				? CODEX_COMMANDS.filter((c) => c.name.includes(before))
				: command?.name === "model" && before.includes(" ")
					? models
							.filter((m) =>
								`${m.id} ${m.name}`
									.toLowerCase()
									.includes(command.args.toLowerCase()),
							)
							.map((m) => ({
								name: m.name || m.id,
								description: m.id,
								insert: `/model ${m.id}`,
							}))
					: command?.name === "effort" && before.includes(" ")
						? (selected?.efforts ?? [])
								.filter((e) => e.startsWith(command.args))
								.map((e) => ({
									name: e === "xhigh" ? "Extra High" : e,
									description: "Reasoning effort",
									insert: `/effort ${e}`,
								}))
						: command?.name === "permissions" && before.includes(" ")
							? ["default", "read-only", "full-access"]
									.filter((value) => value.startsWith(command.args))
									.map((value) => ({
										name: value,
										description: "Codex permissions",
										insert: `/permissions ${value}`,
									}))
							: [];
	const visibleOptions = options.slice(0, 8);
	const choose = (item: { insert: string }) => {
		const start = skillToken ? caret - skillToken[1].length - 1 : 0;
		const next = draft.slice(0, start) + item.insert + draft.slice(caret);
		setDraft(next);
		setCaret(start + item.insert.length);
		setMenuIndex(0);
		setMenuDismissed(!item.insert.endsWith(" "));
		requestAnimationFrame(() => {
			textarea.current?.focus();
			textarea.current?.setSelectionRange(
				start + item.insert.length,
				start + item.insert.length,
			);
		});
	};
	const runCommand = async (name: string, args: string) => {
		if (!args && ["model", "effort", "permissions"].includes(name)) {
			const next = `/${name} `;
			setDraft(next);
			setCaret(next.length);
			setMenuDismissed(false);
			return false;
		}
		if (name === "model") {
			const next = models.find(
				(m) => m.id === args || m.name.toLowerCase() === args.toLowerCase(),
			);
			if (!next)
				throw new Error(
					`Use /model followed by a model ID, or choose one from the model menu.`,
				);
			setChosenModel(next.id);
			setChosenEffort(defaultCodexEffort(next));
			setNotice(`Model set to ${next.name || next.id}.`);
		} else if (name === "effort") {
			const next = /^(extra[- ]?high)$/i.test(args)
				? "xhigh"
				: args.toLowerCase();
			if (!selected?.efforts.includes(next))
				throw new Error(
					`Available efforts: ${(selected?.efforts ?? []).join(", ")}.`,
				);
			setChosenEffort(next);
			setNotice(`Effort set to ${next === "xhigh" ? "Extra High" : next}.`);
		} else if (name === "permissions") {
			if (!["default", "read-only", "full-access"].includes(args))
				throw new Error("Use /permissions default, read-only, or full-access.");
			setPermission(args as CodexPermission);
			setPlan(false);
			setNotice(`Permissions set to ${args}.`);
		} else if (name === "review" || name === "compact") {
			await electronTrpcClient.codexSession.command.mutate({
				key: paneId,
				command: name,
				args,
			});
			setNotice("");
		} else if (name === "skills") {
			setDraft("$");
			setCaret(1);
			setMenuDismissed(false);
			if (skillQuery.isError) void skillQuery.refetch();
			return false;
		} else if (name === "status")
			setNotice(
				`${selected?.name || model} · ${effort === "xhigh" ? "Extra High" : effort} · ${permission} permissions`,
			);
		else if (name === "help")
			setNotice(CODEX_COMMANDS.map((c) => c.name).join(" · "));
		else
			throw new Error(
				`Unknown command /${name}. Type / to see available commands.`,
			);
		return true;
	};
	useEffect(() => {
		const listener = (event: Event) => {
			updateCodexDraft(paneId, { text: (event as CustomEvent<string>).detail });
			textarea.current?.focus();
		};
		window.addEventListener(`codex-draft:${paneId}`, listener);
		return () => window.removeEventListener(`codex-draft:${paneId}`, listener);
	}, [paneId]);
	const attach = async (files: File[]) => {
		for (const file of files) {
			if (/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
				if (file.size > 10_000_000) {
					onError("Choose an image smaller than 10 MB.");
					continue;
				}
				const url = await new Promise<string>((resolve, reject) => {
					const reader = new FileReader();
					reader.onload = () => resolve(String(reader.result));
					reader.onerror = reject;
					reader.readAsDataURL(file);
				});
				setImages((prev) => [...prev, { name: file.name, url }].slice(0, 8));
			} else if (
				file.size <= 200_000 &&
				(file.type.startsWith("text/") ||
					/\.(txt|md|json|csv|ts|tsx|js|jsx|css|html|py|rs|go|sh|ps1|yaml|yml|toml|xml|sql|log)$/i.test(
						file.name,
					))
			) {
				const content = await file.text();
				setDraft(
					(prev) => `${prev}\n\nFile: ${file.name}\n\`\`\`\n${content}\n\`\`\``,
				);
			} else onError("Attach an image or a text file smaller than 200 KB.");
		}
	};
	const send = async () => {
		if (
			sending ||
			working ||
			state?.status !== "idle" ||
			(!draft.trim() && !images.length)
		)
			return;
		setSending(true);
		onError(null);
		try {
			const command = parseCodexCommand(draft);
			if (command) {
				const clear = await runCommand(command.name, command.args);
				if (clear && getCodexDraft(paneId).text === draft) setDraft("");
				return;
			}
			setNotice("");
			await electronTrpcClient.codexSession.send.mutate({
				key: paneId,
				text: draft.trim(),
				model,
				effort,
				permission,
				plan,
				fast,
				images: images.map((i) => i.url),
			});
			// Do not erase a follow-up the user typed while Codex accepted the turn.
			const current = getCodexDraft(paneId);
			updateCodexDraft(paneId, {
				...(current.text === draft ? { text: "" } : {}),
				images: current.images.filter((image) => !images.includes(image)),
			});
		} catch (e) {
			onError(e instanceof Error ? e.message : String(e));
		} finally {
			setSending(false);
			textarea.current?.focus();
		}
	};
	return (
		<div className="session-composer-area">
			<SessionChangesPill changes={changes} provider="codex" />
			{notice && (
				<output className="codex-command-notice">
					{notice}
					<button
						type="button"
						aria-label="Dismiss command result"
						onClick={() => setNotice("")}
					>
						<X size={12} />
					</button>
				</output>
			)}
			{!menuDismissed && (visibleOptions.length > 0 || skillToken) && (
				<div
					className="codex-command-menu"
					id={`codex-commands-${paneId}`}
					role="listbox"
					aria-label="Commands and skills"
				>
					{visibleOptions.map((option, index) => (
						<button
							type="button"
							role="option"
							aria-selected={index === menuIndex}
							id={`codex-command-${paneId}-${index}`}
							key={option.name}
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => choose(option)}
						>
							<strong>{option.name}</strong>
							<span>{option.description}</span>
						</button>
					))}
					{!visibleOptions.length && (
						<p>
							{skillQuery.isPending
								? "Loading skills…"
								: skillQuery.isError
									? "Could not load skills. Run /skills to retry."
									: "No matching skills in this workspace."}
						</p>
					)}
				</div>
			)}
			<div className="session-composer">
				{images.length > 0 && (
					<fieldset className="session-images" aria-label="Attached images">
						{images.map((image, index) => (
							<ComposerImage
								key={`${image.name}:${index}`}
								name={image.name}
								source={image.url}
								onRemove={() =>
									setImages((prev) => prev.filter((_, i) => i !== index))
								}
							/>
						))}
					</fieldset>
				)}
				<div className="session-input">
					<span aria-hidden="true">›</span>
					<GrowingTextarea
						ref={textarea}
						aria-label="Message Codex"
						placeholder="Ask to make changes, /commands, or $skills…"
						value={draft}
						rows={2}
						onChange={(e) => {
							setDraft(e.target.value);
							setCaret(e.target.selectionStart);
							setMenuIndex(0);
							setMenuDismissed(false);
						}}
						onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
						aria-controls={
							visibleOptions.length ? `codex-commands-${paneId}` : undefined
						}
						aria-activedescendant={
							visibleOptions.length
								? `codex-command-${paneId}-${Math.min(menuIndex, visibleOptions.length - 1)}`
								: undefined
						}
						onPaste={(e) => {
							const files = Array.from(e.clipboardData.files);
							if (files.length) {
								e.preventDefault();
								void attach(files).catch((err: Error) => onError(err.message));
							}
						}}
						onKeyDown={(e) => {
							if (e.nativeEvent.isComposing) return;
							const highlighted =
								visibleOptions[Math.min(menuIndex, visibleOptions.length - 1)];
							if (
								highlighted &&
								e.key === "Enter" &&
								!e.shiftKey &&
								(skillToken ||
									(slashToken &&
										!CODEX_COMMANDS.some((c) => c.name === before)))
							) {
								e.preventDefault();
								choose(highlighted);
								return;
							}
							if (
								visibleOptions.length &&
								["ArrowUp", "ArrowDown", "Tab", "Escape"].includes(e.key)
							) {
								e.preventDefault();
								if (e.key === "Escape") setMenuDismissed(true);
								else if (e.key === "Tab" && highlighted) choose(highlighted);
								else
									setMenuIndex(
										(i) =>
											(i +
												(e.key === "ArrowDown" ? 1 : -1) +
												visibleOptions.length) %
											visibleOptions.length,
									);
								return;
							}
							if (
								e.key === "Enter" &&
								!e.shiftKey &&
								!e.nativeEvent.isComposing
							) {
								e.preventDefault();
								void send();
							}
						}}
					/>
				</div>
				<div className="session-composer-toolbar">
					<input
						ref={fileInput}
						type="file"
						multiple
						hidden
						onChange={(e) => {
							void attach(Array.from(e.target.files ?? [])).catch(
								(err: Error) => onError(err.message),
							);
							e.target.value = "";
						}}
					/>
					<button
						type="button"
						className="session-attach"
						aria-label="Attach images or text files"
						title="Attach images or text files"
						onClick={() => fileInput.current?.click()}
					>
						<Paperclip size={18} />
					</button>
					<ComputerControl paneId={paneId} />
					<SessionComposerSettings
						provider="Codex"
						model={model}
						models={models.map((m) => ({ id: m.id, name: m.name || m.id }))}
						onModelChange={(id) => {
							setChosenModel(id);
							setChosenEffort(
								defaultCodexEffort(models.find((m) => m.id === id)),
							);
						}}
						mode={plan ? "plan" : permission}
						modes={[
							{
								id: "default",
								label: "Auto",
								description: "Work with approval when needed",
							},
							{
								id: "plan",
								label: "Plan",
								description: "Think through the approach first",
								kind: "plan",
							},
							{
								id: "full-access",
								label: "Full access",
								description: "Work without approval prompts",
								kind: "full",
							},
							...(permission === "read-only"
								? [
										{
											id: "read-only",
											label: "Read only",
											description: "Explore without editing files",
										},
									]
								: []),
						]}
						onModeChange={(value) => {
							setPlan(value === "plan");
							setPermission(
								value === "plan" ? "default" : (value as CodexPermission),
							);
						}}
						effort={effort}
						efforts={selected?.efforts ?? [effort]}
						onEffortChange={setChosenEffort}
						fast={fast}
						onFastChange={setFast}
						disabled={working || !selected}
					/>
					<button
						type="button"
						className="session-send"
						aria-label={working ? "Stop Codex" : "Send message"}
						disabled={
							!working &&
							(sending ||
								state?.status !== "idle" ||
								(!draft.trim() && !images.length))
						}
						onClick={() => {
							if (working)
								void electronTrpcClient.codexSession.interrupt
									.mutate({ key: paneId })
									.catch((e: Error) => onError(e.message));
							else void send();
						}}
					>
						{working ? (
							<Square size={15} fill="currentColor" />
						) : (
							<ArrowUp size={17} />
						)}
					</button>
				</div>
			</div>
		</div>
	);
}
