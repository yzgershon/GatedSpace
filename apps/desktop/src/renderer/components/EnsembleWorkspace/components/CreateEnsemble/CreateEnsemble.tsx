import {
	ArrowLeft,
	ArrowRight,
	Check,
	ChevronDown,
	Crown,
	FileText,
	Folder,
	Paperclip,
	Plus,
	Rocket,
	ShieldCheck,
	Trash2,
	Users,
	X,
} from "lucide-react";
import { useRef, useState } from "react";
import {
	type EnsembleSession,
	ensembleAgreements,
} from "../../../../../shared/ensemble";
import type { EnsembleProps } from "../../types";
import { AgentIdentity } from "../AgentIdentity/AgentIdentity";

type Slot = {
	id: string;
	provider: "codex" | "claude";
	role: string;
	session?: EnsembleSession;
};
type Agreement = (typeof ensembleAgreements)[number]["id"];
const presets = [
	{
		name: "Pair",
		detail: "Create + challenge",
		roles: ["Coordinator & creator", "Independent reviewer"],
	},
	{
		name: "Balanced",
		detail: "Explore, create, review",
		roles: [
			"Coordinator & synthesizer",
			"Researcher & contributor",
			"Independent reviewer",
		],
	},
	{
		name: "Full team",
		detail: "More independent perspectives",
		roles: [
			"Coordinator & synthesizer",
			"Researcher",
			"Designer",
			"Implementer or writer",
			"Independent reviewer",
		],
	},
];
const slotsFor = (roles: string[]): Slot[] =>
	roles.map((role, i) => ({
		id: crypto.randomUUID(),
		role,
		provider: i % 2 ? "claude" : "codex",
	}));

export function CreateEnsemble({
	sessions,
	workspaces,
	actions,
	evidenceLabel,
	onCreated,
	onClose,
}: {
	sessions: EnsembleSession[];
	onCreated: (id: string) => void;
	onClose: () => void;
} & Pick<EnsembleProps, "workspaces" | "actions" | "evidenceLabel">) {
	const [step, setStep] = useState(0);
	const [title, setTitle] = useState("");
	const [goal, setGoal] = useState("");
	const [criteria, setCriteria] = useState("");
	const [slots, setSlots] = useState<Slot[]>(() => slotsFor(presets[1].roles));
	const [coordinator, setCoordinator] = useState(0);
	const [expanded, setExpanded] = useState(0);
	const [workspace, setWorkspace] = useState(workspaces[0]?.id ?? "");
	const [context, setContext] = useState<
		{ id: string; name: string; text: string }[]
	>([]);
	const [agreements, setAgreements] = useState<Agreement[]>([
		"review",
		"evidence",
	]);
	const [budget, setBudget] = useState(24);
	const [concurrency, setConcurrency] = useState(2);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [progress, setProgress] = useState("");
	const fileInput = useRef<HTMLInputElement>(null);
	const createdId = useRef<string | null>(null);
	const targetWorkspace = workspace || workspaces[0]?.id || "";
	const selectedWorkspace = workspaces.find((w) => w.id === targetWorkspace);
	const newCount = slots.filter((s) => !s.session).length;
	const updateSlot = (i: number, update: Partial<Slot>) =>
		setSlots((current) =>
			current.map((s, n) => (n === i ? { ...s, ...update } : s)),
		);
	function next() {
		setError("");
		if (step === 0 && (goal.trim().length < 5 || criteria.trim().length < 5)) {
			setError("Add a goal and a clear definition of done.");
			return;
		}
		if (step === 1 && newCount && !targetWorkspace) {
			setError("Choose a workspace for the new sessions.");
			return;
		}
		setStep(Math.min(2, step + 1));
	}
	async function attach(files: FileList | null) {
		if (!files) return;
		try {
			if (files.length + context.length > 4)
				throw new Error("Attach up to four text or Markdown references.");
			const additions: { id: string; name: string; text: string }[] = [];
			for (const file of Array.from(files)) {
				if (!/\.(md|txt|csv|json)$/i.test(file.name) || file.size > 48000)
					throw new Error(
						"Use text, Markdown, CSV, or JSON files up to 12,000 characters each.",
					);
				const text = await file.text();
				if (!text.trim() || text.length > 12000 || text.includes("\0"))
					throw new Error(
						`${file.name} must contain 1–12,000 text characters.`,
					);
				additions.push({
					id: crypto.randomUUID(),
					name: file.name.slice(0, 120),
					text,
				});
			}
			setContext((current) => [...current, ...additions]);
			setError("");
		} catch (e) {
			setError(e instanceof Error ? e.message : "Couldn't read the reference.");
		}
		if (fileInput.current) fileInput.current.value = "";
	}
	async function finish(launch: boolean) {
		if (busy) return;
		setBusy(true);
		setError("");
		try {
			const members = [];
			for (let i = 0; i < slots.length; i++) {
				const slot = slots[i];
				setProgress(`Preparing session ${i + 1} of ${slots.length}`);
				const session =
					slot.session ??
					(await actions.createSession(slot.provider, targetWorkspace));
				updateSlot(i, { session });
				members.push({
					...session,
					role: slot.role.trim() || "Contributor",
					title: slot.session?.title ?? slot.role,
				});
			}
			const id =
				createdId.current ??
				(await actions.create({
					title:
						title.trim() ||
						goal
							.trim()
							.split(/[\n.!?]/)[0]
							.slice(0, 70),
					goal,
					criteria,
					members,
					commanderIndex: coordinator,
					maxMessages: budget,
					concurrency,
					context,
					agreements,
				}));
			createdId.current = id;
			if (launch) {
				setProgress("Starting the coordinator");
				await actions.control(id, "start");
			}
			onCreated(id);
		} catch (e) {
			setError(
				(e instanceof Error ? e.message : "Couldn't prepare the team.") +
					" Prepared sessions are kept and can be selected again.",
			);
		} finally {
			setBusy(false);
			setProgress("");
		}
	}
	return (
		<section className="en-setup" aria-label="Create a flock">
			<header className="en-setup-header">
				<div>
					<Users size={17} />
					<strong>New flock</strong>
				</div>
				<button
					type="button"
					className="en-icon-button"
					aria-label="Close team setup"
					disabled={busy}
					onClick={onClose}
				>
					<X size={17} />
				</button>
			</header>
			{evidenceLabel && (
				<p className="en-live-disclosure">
					Live preview · Save draft creates real sessions; Launch starts the
					team.
				</p>
			)}
			<nav className="en-steps" aria-label="Team setup steps">
				{["Mission", "Roster", "Launch"].map((label, i) => (
					<button
						key={label}
						type="button"
						aria-current={step === i ? "step" : undefined}
						disabled={i > step || busy}
						onClick={() => {
							setStep(i);
							setError("");
						}}
					>
						<span>{i < step ? <Check size={13} /> : i + 1}</span>
						{label}
					</button>
				))}
			</nav>
			<div className="en-setup-body" inert={busy}>
				{step === 0 && (
					<>
						<div className="en-step-heading">
							<h1>Give the team a mission</h1>
							<p>
								Set the outcome and the finish line. Every member gets the same
								brief.
							</p>
						</div>
						<label className="en-folder-label">
							<span>
								<Folder size={15} />
								Workspace for new sessions
							</span>
							<select
								aria-label="Workspace for new sessions"
								value={targetWorkspace}
								onChange={(e) => setWorkspace(e.target.value)}
							>
								{!workspaces.length && (
									<option value="">No workspace available</option>
								)}
								{workspaces.map((w) => (
									<option key={w.id} value={w.id}>
										{w.project} / {w.name}
									</option>
								))}
							</select>
						</label>
						<label>
							Goal
							<textarea
								value={goal}
								onChange={(e) => setGoal(e.target.value)}
								rows={4}
								maxLength={8000}
								placeholder="What should this team accomplish?"
							/>
						</label>
						<label>
							Definition of done
							<textarea
								value={criteria}
								onChange={(e) => setCriteria(e.target.value)}
								rows={2}
								maxLength={4000}
								placeholder="The deliverable, the checks it must pass, and what you want reviewed."
							/>
						</label>
						<div className="en-context-heading">
							<span>
								Shared context <small>Optional</small>
							</span>
							<button
								type="button"
								onClick={() => fileInput.current?.click()}
								disabled={context.length >= 4}
							>
								<Paperclip size={14} />
								Attach references
							</button>
							<input
								className="en-sr-only"
								ref={fileInput}
								tabIndex={-1}
								type="file"
								multiple
								accept=".txt,.md,.json,.csv"
								aria-label="Choose shared reference files"
								onChange={(e) => void attach(e.target.files)}
							/>
						</div>
						{context.length ? (
							context.map((file, i) => (
								<div className="en-context-file" key={file.id}>
									<FileText size={16} />
									<span>
										{file.name}
										<small>
											{file.text.length.toLocaleString()} characters · copied
											into this group
										</small>
									</span>
									<button
										className="en-icon-button"
										type="button"
										aria-label={`Remove ${file.name}`}
										onClick={() =>
											setContext(context.filter((_, n) => n !== i))
										}
									>
										<X size={14} />
									</button>
								</div>
							))
						) : (
							<p className="en-field-hint">
								Add notes or a specification as text or Markdown. References
								stay with this group across restarts.
							</p>
						)}
					</>
				)}
				{step === 1 && (
					<>
						<div className="en-step-heading">
							<h1>Build your roster</h1>
							<p>
								Mix Claude and Codex. Choose a coordinator, then give each
								member a clear responsibility.
							</p>
						</div>
						<div className="en-presets">
							{presets.map((preset) => (
								<button
									type="button"
									key={preset.name}
									aria-pressed={slots.length === preset.roles.length}
									onClick={() => {
										setSlots(slotsFor(preset.roles));
										setCoordinator(0);
										setExpanded(0);
									}}
								>
									<strong>
										{preset.roles.length}
										<span>{preset.name}</span>
									</strong>
									<small>{preset.detail}</small>
								</button>
							))}
						</div>
						<div className="en-roster-summary">
							<span>
								<Crown size={14} />1 coordinator
							</span>
							<span>
								{slots.length - 1}{" "}
								{slots.length === 2 ? "contributor" : "contributors"}
							</span>
							<span className="en-muted">
								{slots.filter((s) => s.provider === "codex").length} Codex ·{" "}
								{slots.filter((s) => s.provider === "claude").length} Claude
							</span>
						</div>
						<div className="en-roster">
							{slots.map((slot, i) => (
								<div
									key={slot.id}
									className={`en-roster-row ${expanded === i ? "is-expanded" : ""}`}
								>
									<button
										type="button"
										className="en-roster-toggle"
										aria-expanded={expanded === i}
										onClick={() => setExpanded(expanded === i ? -1 : i)}
									>
										<span className="en-roster-number">
											{String(i + 1).padStart(2, "0")}
										</span>
										<AgentIdentity provider={slot.provider} size={22} />
										<span>
											<strong>{slot.role}</strong>
											<small>
												{slot.session
													? slot.session.title
													: "New " +
														(slot.provider === "codex"
															? "Codex"
															: "Claude Code") +
														" session"}
											</small>
										</span>
										{coordinator === i && (
											<Crown size={14} className="en-pink" />
										)}
										<ChevronDown size={15} />
									</button>
									{expanded === i && (
										<div className="en-roster-fields">
											<label>
												Responsibility
												<input
													value={slot.role}
													maxLength={240}
													onChange={(e) =>
														updateSlot(i, { role: e.target.value })
													}
												/>
											</label>
											<label>
												Session
												<select
													aria-label="Session"
													value={
														slot.session
															? `${slot.provider}:${slot.session.key}`
															: `new:${slot.provider}`
													}
													onChange={(e) => {
														const value = e.target.value;
														if (value.startsWith("new:"))
															updateSlot(i, {
																provider:
																	value === "new:claude" ? "claude" : "codex",
																session: undefined,
															});
														else {
															const s = sessions.find(
																(s) => `${s.provider}:${s.key}` === value,
															);
															if (s)
																updateSlot(i, {
																	session: s,
																	provider: s.provider,
																});
														}
													}}
												>
													<optgroup label="Create dedicated">
														<option value="new:codex">New Codex session</option>
														<option value="new:claude">
															New Claude Code session
														</option>
													</optgroup>
													<optgroup label="Connect existing">
														{sessions
															.filter(
																(s) =>
																	!slots.some(
																		(other, n) =>
																			n !== i &&
																			other.session?.key === s.key &&
																			other.provider === s.provider,
																	),
															)
															.map((s) => (
																<option
																	key={`${s.provider}:${s.key}`}
																	value={`${s.provider}:${s.key}`}
																>
																	{s.title} · {s.provider}
																	{s.status === "working"
																		? " · busy, messages will wait"
																		: ""}
																</option>
															))}
													</optgroup>
												</select>
											</label>
											<div className="en-roster-actions">
												<button
													type="button"
													aria-pressed={coordinator === i}
													onClick={() => setCoordinator(i)}
												>
													<Crown size={14} />
													{coordinator === i
														? "Coordinator"
														: "Make coordinator"}
												</button>
												<button
													type="button"
													aria-label={`Remove member ${i + 1}`}
													disabled={slots.length <= 2}
													onClick={() => {
														setSlots(slots.filter((_, n) => i !== n));
														setCoordinator(
															i === coordinator
																? 0
																: coordinator > i
																	? coordinator - 1
																	: coordinator,
														);
														setExpanded(-1);
													}}
												>
													<Trash2 size={14} />
													Remove
												</button>
											</div>
										</div>
									)}
								</div>
							))}
						</div>
						<button
							type="button"
							className="en-add-member"
							disabled={slots.length >= 6}
							onClick={() => {
								setSlots([...slots, ...slotsFor(["Contributor"])]);
								setExpanded(slots.length);
							}}
						>
							<Plus size={15} />
							Add member<span>{slots.length}/6</span>
						</button>
						<fieldset className="en-agreements">
							<legend>Working agreements</legend>
							{ensembleAgreements.map((a) => (
								<label key={a.id}>
									<input
										type="checkbox"
										checked={agreements.includes(a.id)}
										disabled={a.id === "review"}
										onChange={(e) =>
											setAgreements(
												e.target.checked
													? [...agreements, a.id]
													: agreements.filter((id) => id !== a.id),
											)
										}
									/>
									<span>
										<strong>{a.title}</strong>
										<small>{a.description}</small>
									</span>
								</label>
							))}
						</fieldset>
					</>
				)}
				{step === 2 && (
					<>
						<div className="en-step-heading">
							<h1>Review & launch</h1>
							<p>
								The coordinator gets the brief first. Contributions and reviews
								appear in the shared workspace.
							</p>
						</div>
						<label>
							Flock name <span className="en-field-hint">Optional</span>
							<input
								value={title}
								onChange={(e) => setTitle(e.target.value)}
								maxLength={100}
								placeholder={
									goal
										.trim()
										.split(/[\n.!?]/)[0]
										.slice(0, 70) || "Name this collaboration"
								}
							/>
						</label>
						<dl className="en-launch-summary">
							<div>
								<dt>Mission</dt>
								<dd>{goal}</dd>
							</div>
							<div>
								<dt>Done when</dt>
								<dd>{criteria}</dd>
							</div>
							<div>
								<dt>Workspace</dt>
								<dd>
									{selectedWorkspace
										? `${selectedWorkspace.project} / ${selectedWorkspace.name}`
										: "Existing sessions keep their workspace"}
								</dd>
							</div>
							<div>
								<dt>Team</dt>
								<dd>
									{slots.map((s, i) => (
										<span key={s.id}>
											<AgentIdentity provider={s.provider} size={16} />
											{s.role}
											{i === coordinator && <Crown size={12} />}
										</span>
									))}
								</dd>
							</div>
							<div>
								<dt>Context</dt>
								<dd>
									{context.length
										? context.map((c) => c.name).join(", ")
										: "Mission brief only"}
								</dd>
							</div>
							<div>
								<dt>Agreements</dt>
								<dd>
									{ensembleAgreements
										.filter((a) => agreements.includes(a.id))
										.map((a) => a.title)
										.join(" · ")}
								</dd>
							</div>
						</dl>
						<div className="en-launch-permissions">
							<ShieldCheck size={18} />
							<div>
								<strong>Each session keeps its permissions</strong>
								<p>
									Approvals stay with you. Busy sessions receive messages after
									their current turn.
								</p>
							</div>
						</div>
						<div className="en-run-limits">
							<label>
								Delivery budget
								<input
									type="number"
									min={4}
									max={100}
									value={budget}
									onChange={(e) => setBudget(Number(e.target.value))}
								/>
							</label>
							<label>
								Concurrent turns
								<select
									value={concurrency}
									onChange={(e) => setConcurrency(Number(e.target.value))}
								>
									<option value={1}>1 at a time</option>
									<option value={2}>Up to 2</option>
									<option value={3}>Up to 3</option>
								</select>
							</label>
						</div>
						<p className="en-field-hint">
							Sessions in the same folder take turns. Select sessions in
							separate existing worktrees for parallel edits.
						</p>
					</>
				)}
				{error && (
					<p role="alert" className="en-error">
						{error}
					</p>
				)}
			</div>
			<footer className="en-setup-footer">
				<button
					type="button"
					disabled={busy}
					onClick={() => (step ? setStep(step - 1) : onClose())}
				>
					<ArrowLeft size={14} />
					{step ? "Back" : "Cancel"}
				</button>
				<span>
					{busy
						? progress
						: step === 2
							? newCount +
								" new · " +
								(slots.length - newCount) +
								" existing sessions"
							: `Step ${step + 1} of 3`}
				</span>
				<div>
					{step === 2 && (
						<button
							type="button"
							disabled={busy}
							onClick={() => void finish(false)}
						>
							Save draft
						</button>
					)}
					<button
						type="button"
						className="en-primary"
						disabled={
							busy ||
							(step === 2 &&
								(!Number.isInteger(budget) || budget < 4 || budget > 100))
						}
						onClick={() => (step === 2 ? void finish(true) : next())}
					>
						{step === 2 ? <Rocket size={15} /> : null}
						{step === 2 ? "Launch team" : "Next"}
						{step !== 2 && <ArrowRight size={15} />}
					</button>
				</div>
			</footer>
		</section>
	);
}
