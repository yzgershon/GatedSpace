import { TooltipProvider } from "@superset/ui/tooltip";
import {
	ArrowUp,
	Folder,
	Maximize2,
	MoreHorizontal,
	PanelBottom,
	PanelRight,
	Paperclip,
	Plus,
	X,
} from "lucide-react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { SessionWelcome } from "../../src/renderer/components/SessionWelcome";
import { useThemeStore } from "../../src/renderer/stores/theme";
import { draculaTheme } from "../../src/shared/themes/built-in/dracula";
import { ComposerSettings } from "./ComposerSettings";
import { GrowingInput } from "./GrowingInput";
import "../../src/renderer/globals.css";
import "./style.css";

for (const [key, value] of Object.entries(draculaTheme.ui))
	if (typeof value === "string")
		document.documentElement.style.setProperty(
			`--${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`,
			value,
		);
document.documentElement.classList.add("dark");
useThemeStore.getState().setTheme(draculaTheme.id);

const longPrompt = [
	"Update the session experience in GatedSpace.",
	"Keep the Dracula colors and floating tabs.",
	"Give both agents the same Focus composer.",
	"Keep the model name at the bottom right.",
	"Open the settings from that model name.",
	"Include Auto, Plan, and Full access.",
	"Default reasoning effort to Extra High.",
	"Keep the effort slider compact and smooth.",
	"Let the lightning button turn on Fast.",
	"This is the tenth fully visible line.",
	"The eleventh line fades to show more below.",
	"The remaining text stays in this same field.",
	"Scroll down to keep reading or editing.",
	"Keep attachments beside the typing area.",
	"Show slash commands when I type a slash.",
	"Show skills when I type the dollar sign.",
	"Keep the send button anchored at the bottom.",
	"Align the session heroes across both panes.",
	"Preserve the prompt when settings change.",
	"This is line twenty. Nothing is sent by this preview.",
].join("\n");
function Pane({
	provider,
	focused,
	onFocus,
	expanded,
	onExpand,
	demo,
}: {
	provider: "claude" | "codex";
	focused: boolean;
	onFocus: () => void;
	expanded: boolean;
	onExpand: () => void;
	demo: "short" | "long";
}) {
	const [draft, setDraft] = useState(demo === "long" ? longPrompt : "");
	const [sent, setSent] = useState("");
	const name = provider === "codex" ? "Codex" : "Claude";
	return (
		<section
			className="preview-pane"
			data-focused={focused}
			onFocusCapture={onFocus}
			onPointerDownCapture={onFocus}
		>
			<header>
				<Folder size={19} />
				<strong>{name}</strong>
				<button
					title="New pane"
					type="button"
					onClick={() => setSent("New-pane control stays in this position.")}
				>
					<Plus size={16} />
				</button>
				<button
					title="Pane menu"
					type="button"
					onClick={() => setSent("The existing pane menu is preserved.")}
				>
					<MoreHorizontal size={16} />
				</button>
				<span />
				<button
					aria-label={expanded ? "Restore pane" : "Expand pane"}
					onClick={onExpand}
					type="button"
				>
					<Maximize2 size={15} />
				</button>
				{provider === "codex" && (
					<>
						<PanelBottom size={16} />
						<PanelRight size={16} />
					</>
				)}
				<X size={16} />
			</header>
			<div className="preview-conversation">
				{sent ? (
					<div className="preview-message">
						<p>{sent}</p>
						<span>Preview only · nothing is sent to an agent.</span>
						<button type="button" onClick={() => setSent("")}>
							Back to empty session
						</button>
					</div>
				) : (
					<SessionWelcome provider={provider} onSuggest={setDraft} />
				)}
			</div>
			<div className="preview-composer line">
				<div className="preview-input">
					<span aria-hidden="true">›</span>
					<GrowingInput name={name} value={draft} onChange={setDraft} />
				</div>
				{(draft.startsWith("/") || draft.startsWith("$")) && (
					<div className="preview-palette">
						{(draft.startsWith("/")
							? ["/review", "/model", "/effort", "/compact"]
							: [
									"$image-to-code",
									"$redesign-existing-projects",
									"$vercel-react-best-practices",
								]
						).map((item) => (
							<button
								key={item}
								type="button"
								onClick={() => setDraft(`${item} `)}
							>
								{item}
							</button>
						))}
					</div>
				)}
				<div className="preview-composer-toolbar">
					<label title="Attach a file" className="preview-attach">
						<Paperclip size={16} />
						<input
							type="file"
							onChange={(e) =>
								setDraft(
									`${draft}\n[${e.target.files?.[0]?.name ?? "attachment"}]`,
								)
							}
						/>
					</label>
					<span className="preview-toolbar-spacer" />
					<ComposerSettings provider={provider} />
					<button
						aria-label={`Send to ${name}`}
						className="preview-send"
						type="button"
						disabled={!draft.trim()}
						onClick={() => {
							setSent(draft);
							setDraft("");
						}}
					>
						<ArrowUp size={18} />
					</button>
				</div>
			</div>
		</section>
	);
}
function App() {
	const [demo, setDemo] = useState<"short" | "long">("short");
	const [demoRevision, setDemoRevision] = useState(0);
	const [focused, setFocused] = useState("codex");
	const [expanded, setExpanded] = useState<string | null>(null);
	return (
		<TooltipProvider>
			<main className="preview-shell">
				<nav className="preview-options">
					<div>
						<strong>Focus, refined</strong>
						<span>Dracula · interactive preview</span>
					</div>
					<fieldset aria-label="Prompt length demo">
						<button
							type="button"
							aria-pressed={demo === "short"}
							onClick={() => {
								setDemo("short");
								setDemoRevision((n) => n + 1);
							}}
						>
							Empty prompt
						</button>
						<button
							type="button"
							aria-pressed={demo === "long"}
							onClick={() => {
								setDemo("long");
								setDemoRevision((n) => n + 1);
							}}
						>
							Try 20 lines
						</button>
					</fieldset>
					<p>
						Click the model for modes, effort, and Fast. Try a long prompt to
						see the ten-line limit.
					</p>
				</nav>
				<div className="preview-app">
					<div className="preview-topbar">
						<strong>GatedSpace</strong>
						<span>Claude + Codex</span>
						<small>Design preview · nothing is sent</small>
					</div>
					<div className="preview-workspace">
						<aside>
							<Folder size={23} />
							<strong>SecondBrain</strong>
							<div>RECENT SESSIONS</div>
							<button type="button" onClick={() => setFocused("codex")}>
								GatedSpace edits
							</button>
							<button type="button" onClick={() => setFocused("claude")}>
								Review my changes
							</button>
							<footer>
								<span>{focused === "codex" ? "CODEX" : "CLAUDE"} · USAGE</span>
								<p>Follows focused pane</p>
								<small>Live limits will come from your account.</small>
							</footer>
						</aside>
						<div className="preview-panes">
							{(["claude", "codex"] as const)
								.filter((p) => !expanded || expanded === p)
								.map((p) => (
									<Pane
										key={`${p}-${demoRevision}`}
										provider={p}
										demo={demo}
										focused={focused === p}
										onFocus={() => setFocused(p)}
										expanded={expanded === p}
										onExpand={() => setExpanded(expanded === p ? null : p)}
									/>
								))}
						</div>
					</div>
				</div>
			</main>
		</TooltipProvider>
	);
}
const root = document.createElement("div");
document.body.append(root);
createRoot(root).render(<App />);
