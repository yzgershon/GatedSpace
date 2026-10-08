import { createWorkspaceStore, type PaneRegistry } from "@superset/panes";
import { TooltipProvider } from "@superset/ui/tooltip";
import {
	ArrowUp,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Plus,
	Search,
	X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { createRoot } from "react-dom/client";
import claude from "../../../../packages/ui/src/assets/icons/preset-icons/claude.svg";
import codex from "../../../../packages/ui/src/assets/icons/preset-icons/codex.svg";
import { CodexApprovalCard } from "../../src/renderer/components/CodexSession/components/CodexApprovalCard/CodexApprovalCard";
import { SessionChangesPill } from "../../src/renderer/components/SessionComposerControls/SessionChangesPill/SessionChangesPill";
import { TabRail } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/components/TabRail/TabRail";
import type { PaneViewerData } from "../../src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/types";
import { draculaTheme } from "../../src/shared/themes/built-in/dracula";
import { lightTheme } from "../../src/shared/themes/built-in/light";
import { resetReplies } from "./mock";
import "../../src/renderer/globals.css";
import "../../src/renderer/components/CodexSession/codex-session.css";
import "./style.css";

const names = [
	"GS Edits",
	"Filtrsoft",
	"Remotion Ads",
	"Emails and texts",
	"OMEN continuity",
	"Mobile companion",
	"Research notes",
	"Battery audit",
];
const examples = (count: number) =>
	Array.from({ length: count }, (_, i) => ({
		id: i + 1,
		name: names[i % names.length] + (i >= 8 ? ` ${i + 1}` : ""),
		provider: i % 3 ? "claude" : "codex",
	}));
type PreviewTab = ReturnType<typeof examples>[number];
const concepts = [
	{
		id: "A",
		name: "Flow",
		tag: "Recommended",
		description:
			"Scroll through a steady strip. Soft edges show more tabs; arrows and the full list give you precise access.",
	},
	{
		id: "B",
		name: "Four + more",
		tag: "Quiet",
		description:
			"Up to four tabs stay visible. A searchable overflow menu holds the rest, and the selected tab always stays in view.",
	},
	{
		id: "C",
		name: "Focus",
		tag: "Most compact",
		description:
			"A generous active tab, two recent icons when space allows, and a searchable switcher for every conversation.",
	},
];
function Icon({ tab }: { tab: PreviewTab }) {
	return (
		<img
			src={tab.provider === "codex" ? codex : claude}
			alt=""
			width="18"
			height="18"
		/>
	);
}

function TabConcept({
	variant,
	tabs,
	active,
	select,
	add,
	close,
}: {
	variant: string;
	tabs: PreviewTab[];
	active: number;
	select: (id: number) => void;
	add: () => void;
	close: (id: number) => void;
}) {
	const rail = useRef<HTMLDivElement>(null);
	const scroll = useRef<HTMLDivElement>(null);
	const menuButton = useRef<HTMLButtonElement>(null);
	const [width, setWidth] = useState(500);
	const [edges, setEdges] = useState({ left: false, right: false });
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	useLayoutEffect(() => {
		const node = rail.current;
		if (!node) return;
		const measure = () => setWidth(node.clientWidth);
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		measure();
		return () => observer.disconnect();
	}, []);
	useLayoutEffect(() => {
		const node = scroll.current;
		if (!node) return;
		const measure = () =>
			setEdges({
				left: node.scrollLeft > 2,
				right: node.scrollLeft + node.clientWidth < node.scrollWidth - 2,
			});
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		node.addEventListener("scroll", measure);
		measure();
		return () => {
			observer.disconnect();
			node.removeEventListener("scroll", measure);
		};
	}, []);
	useLayoutEffect(() => {
		const node = scroll.current;
		const selected = node?.querySelector<HTMLElement>(`[data-tab="${active}"]`);
		if (node && selected) {
			const a = selected.getBoundingClientRect(),
				b = node.getBoundingClientRect();
			if (a.left < b.left) node.scrollLeft -= b.left - a.left;
			else if (a.right > b.right) node.scrollLeft += a.right - b.right;
			setEdges({
				left: node.scrollLeft > 2,
				right: node.scrollLeft + node.clientWidth < node.scrollWidth - 2,
			});
		}
	}, [active]);
	useEffect(() => {
		if (!open) return;
		const outside = (e: PointerEvent) => {
			if (!rail.current?.contains(e.target as Node)) setOpen(false);
		};
		const key = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				setOpen(false);
				menuButton.current?.focus();
			}
		};
		document.addEventListener("pointerdown", outside);
		document.addEventListener("keydown", key);
		return () => {
			document.removeEventListener("pointerdown", outside);
			document.removeEventListener("keydown", key);
		};
	}, [open]);
	const slots = Math.max(1, Math.min(4, Math.floor((width - 104) / 128)));
	const current = tabs.find((t) => t.id === active) ?? tabs[0];
	let visible = variant === "A" ? tabs : tabs.slice(0, slots);
	if (variant === "B" && current && !visible.some((t) => t.id === active))
		visible = [...visible.slice(0, -1), current];
	if (variant === "C")
		visible = [
			current,
			...tabs
				.filter((t) => t.id !== active)
				.slice(0, width > 440 ? 2 : width > 330 ? 1 : 0),
		].filter(Boolean);
	const step = (direction: number) =>
		scroll.current?.scrollBy({
			left: direction * 144,
			behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
				? "instant"
				: "smooth",
		});
	return (
		<div className={`concept-rail variant-${variant}`} ref={rail}>
			<div
				className="tabs-window"
				data-fade-left={variant === "A" && edges.left}
				data-fade-right={variant === "A" && edges.right}
			>
				<div className="concept-scroll" ref={scroll}>
					{visible.map((tab) => (
						<div
							key={tab.id}
							data-tab={tab.id}
							className={`concept-tab ${active === tab.id ? "selected" : ""} ${variant === "C" && tab.id !== active ? "icon-only" : ""}`}
						>
							<button
								type="button"
								title={tab.name}
								aria-label={`Open ${tab.name}`}
								aria-pressed={active === tab.id}
								onClick={() => select(tab.id)}
							>
								<Icon tab={tab} />
								<span>{tab.name}</span>
							</button>
							{active === tab.id && tabs.length > 1 && (
								<button
									type="button"
									className="close-tab"
									aria-label={`Close ${tab.name}`}
									onClick={() => close(tab.id)}
								>
									<X size={13} />
								</button>
							)}
						</div>
					))}
				</div>
			</div>
			<div className="fixed-controls">
				{variant === "A" && width > 380 && (
					<div className="step-tabs">
						<button
							type="button"
							aria-label="Previous tabs"
							disabled={!edges.left}
							onClick={() => step(-1)}
						>
							<ChevronLeft size={14} />
						</button>
						<button
							type="button"
							aria-label="Next tabs"
							disabled={!edges.right}
							onClick={() => step(1)}
						>
							<ChevronRight size={14} />
						</button>
					</div>
				)}
				<button
					type="button"
					ref={menuButton}
					className="all-tabs"
					aria-label="Find a tab"
					aria-expanded={open}
					onClick={() => {
						setOpen(!open);
						setQuery("");
					}}
				>
					{variant === "B"
						? `+${Math.max(0, tabs.length - visible.length)}`
						: tabs.length}
					<ChevronDown size={12} />
				</button>
				<button
					type="button"
					className="new-tab"
					aria-label="New tab"
					onClick={add}
				>
					<Plus size={19} />
				</button>
			</div>
			{open && (
				<section className="tab-menu" aria-label="Find a conversation">
					<label>
						<Search size={15} />
						<input
							ref={(node) => node?.focus()}
							aria-label="Search tabs"
							placeholder="Find a conversation"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
						/>
					</label>
					<div className="tab-results">
						{tabs
							.filter((t) => t.name.toLowerCase().includes(query.toLowerCase()))
							.map((tab) => (
								<button
									type="button"
									key={tab.id}
									aria-label={`Switch to ${tab.name}`}
									onClick={() => {
										select(tab.id);
										setOpen(false);
									}}
								>
									<Icon tab={tab} />
									<span>{tab.name}</span>
									{tab.id === active && <small>Active</small>}
								</button>
							))}
						{!tabs.some((t) =>
							t.name.toLowerCase().includes(query.toLowerCase()),
						) && <p>No matching conversations</p>}
					</div>
				</section>
			)}
		</div>
	);
}

const store = createWorkspaceStore<PaneViewerData>();
function addProductionTab() {
	const n = store.getState().tabs.length;
	store.getState().addTab({
		titleOverride: `${names[n % names.length]} ${n + 1}`,
		panes: [{ kind: "launcher", data: {} }],
	});
}
for (let i = 0; i < 16; i++) addProductionTab();
const registry: PaneRegistry<PaneViewerData> = {
	launcher: {
		renderPane: () => null,
		getTitle: () => "Session",
		getTabIcon: () => <img src={codex} width="18" height="18" alt="" />,
	},
};

function Preview() {
	const [variant, setVariant] = useState("A");
	const [tabs, setTabs] = useState(examples(8));
	const [active, setActive] = useState(1);
	const [width, setWidth] = useState(650);
	const [light, setLight] = useState(false);
	const [provider, setProvider] = useState<"codex" | "claude">("codex");
	const [scenario, setScenario] = useState("single");
	const [revision, setRevision] = useState(0);
	const [receipt, setReceipt] = useState("");
	const nextId = useRef(9);
	useEffect(() => {
		for (const [key, value] of Object.entries(
			(light ? lightTheme : draculaTheme).ui,
		))
			if (typeof value === "string")
				document.documentElement.style.setProperty(
					`--${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`,
					value,
				);
		document.documentElement.classList.toggle("dark", !light);
	}, [light]);
	useEffect(() => {
		const receive = (e: Event) => {
			const reply = (e as CustomEvent).detail;
			setReceipt(
				reply.allow ? Object.values(reply.answers).join(" / ") : "Dismissed",
			);
		};
		window.addEventListener("preview-reply", receive);
		return () => window.removeEventListener("preview-reply", receive);
	}, []);
	const reset = (value = scenario) => {
		setScenario(value);
		setRevision((r) => r + 1);
		setReceipt("");
		resetReplies(value === "retry");
	};
	return (
		<main className="controls-preview">
			<header className="preview-heading">
				<div>
					<span className="eyebrow">GatedSpace / Design review</span>
					<h1>Room for every conversation.</h1>
					<p>
						Three ways to keep your tabs within reach. The + button always has
						its own space.
					</p>
				</div>
				<button
					type="button"
					className="subtle-button"
					onClick={() => setLight(!light)}
				>
					{light ? "Dark" : "Light"} theme
				</button>
			</header>
			<div className="concept-choices">
				{concepts.map((c) => (
					<button
						type="button"
						key={c.id}
						aria-pressed={variant === c.id}
						onClick={() => setVariant(c.id)}
					>
						<span className="concept-letter">{c.id}</span>
						<span>
							<strong>{c.name}</strong>
							<small>{c.tag}</small>
						</span>
					</button>
				))}
			</div>
			<p className="concept-description">
				{concepts.find((c) => c.id === variant)?.description}
			</p>
			<div className="preview-controls">
				<label>
					Available width{" "}
					<input
						aria-label="Available width"
						type="range"
						min="240"
						max="720"
						step="10"
						value={width}
						onChange={(e) => setWidth(Number(e.target.value))}
					/>
					<output>{width}px</output>
				</label>
				<label>
					Tabs{" "}
					<select
						aria-label="Tab count"
						value={[4, 8, 16].includes(tabs.length) ? tabs.length : "custom"}
						onChange={(e) => {
							const n = Number(e.target.value);
							setTabs(examples(n));
							setActive(1);
							nextId.current = n + 1;
						}}
					>
						<option value="4">4</option>
						<option value="8">8</option>
						<option value="16">16</option>
						<option value="custom" disabled>
							{tabs.length}
						</option>
					</select>
				</label>
			</div>
			<section className="production-check selected-hybrid">
				<span className="eyebrow">
					Selected design / A + current hover behavior
				</span>
				<h2>Flow with expanding tabs</h2>
				<p>
					Hover to expand a tab. Other tabs become icons. Use arrows, the mouse
					wheel, or the keyboard to reach any of the 16 sample conversations.
				</p>
				<div className="production-rail" style={{ width, maxWidth: "100%" }}>
					<TabRail
						store={store}
						registry={registry}
						onNewGroup={addProductionTab}
						onCloseGroup={(id) => store.getState().removeTab(id)}
					/>
				</div>
			</section>
			<p className="eyebrow">Original comparison concept</p>
			<section className="preview-stage">
				<div className="resizable-stage" style={{ width, maxWidth: "100%" }}>
					<TabConcept
						key={variant}
						variant={variant}
						tabs={tabs}
						active={active}
						select={setActive}
						add={() => {
							const id = nextId.current++;
							setTabs([
								...tabs,
								{ id, name: `New conversation ${id}`, provider: "codex" },
							]);
							setActive(id);
						}}
						close={(id) => {
							const rest = tabs.filter((t) => t.id !== id);
							setTabs(rest);
							if (active === id) setActive(rest.at(-1)?.id ?? 1);
						}}
					/>
					<div className="conversation-sample">
						<span className="eyebrow">Selected conversation</span>
						<h2>{tabs.find((t) => t.id === active)?.name}</h2>
						<p>
							Try adding tabs, switching conversations, closing the active tab,
							or narrowing the space.
						</p>
						<span className="sample-note">
							Interactive sample · no real sessions are changed
						</span>
					</div>
				</div>
			</section>
			<section className="controls-section">
				<div className="section-heading">
					<div>
						<span className="eyebrow">Composer</span>
						<h2>Clearer changes, closer to your message.</h2>
					</div>
					<select
						aria-label="Composer provider"
						value={provider}
						onChange={(e) => setProvider(e.target.value as "codex" | "claude")}
					>
						<option value="codex">Codex</option>
						<option value="claude">Claude</option>
					</select>
				</div>
				<div className="composer-sample">
					<SessionChangesPill
						provider={provider}
						changes={{ files: 24, added: 97, removed: 19 }}
					/>
					<div className="sample-composer">
						<span>Ask for the next change...</span>
						<div>
							<Plus size={20} />
							<span>
								{provider === "codex" ? "GPT-6 Astra" : "Claude Opus"}
							</span>
							<button type="button" aria-label="Demo composer only" disabled>
								<ArrowUp size={19} />
							</button>
						</div>
					</div>
				</div>
			</section>
			<section className="controls-section">
				<div className="section-heading">
					<div>
						<span className="eyebrow">Questions</span>
						<h2>A reply you can actually click.</h2>
					</div>
					<select
						aria-label="Question scenario"
						value={scenario}
						onChange={(e) => reset(e.target.value)}
					>
						<option value="single">Single question</option>
						<option value="multiple">Two questions</option>
						<option value="retry">Connection retry</option>
					</select>
				</div>
				<div className="codex-question-dock">
					<CodexApprovalCard
						key={`${scenario}-${revision}`}
						sessionKey="preview"
						approval={{
							id: "demo",
							sourceItemId: "sample",
							method: "gatedspace/requestUserInput",
							turnId: "preview",
							title: "Preview question",
							isBlocking: false,
							detail: "",
							questions: [
								{
									id: "format",
									question:
										"Which format would you like for the GatedSpace ad?",
									options: ["Widescreen 16:9 (Recommended)", "Vertical 9:16"],
									descriptions: [
										"Show the full desktop interface.",
										"Fill the screen on a phone.",
									],
								},
								...(scenario === "multiple"
									? [
											{
												id: "length",
												question: "How long should the ad be?",
												options: ["20 seconds", "30 seconds"],
											},
										]
									: []),
							],
						}}
					/>
				</div>
				<div className="preview-receipt">
					<output>
						{receipt
							? `Sample reply received: ${receipt}`
							: "Preview only. Replies stay on this page."}
					</output>
					<button type="button" onClick={() => reset()}>
						Reset question
					</button>
				</div>
			</section>
		</main>
	);
}
const mount = document.createElement("div");
document.body.append(mount);
createRoot(mount).render(
	<DndProvider backend={HTML5Backend}>
		<TooltipProvider>
			<Preview />
		</TooltipProvider>
	</DndProvider>,
);
