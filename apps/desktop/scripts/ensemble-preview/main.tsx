import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { EnsembleWorkspace } from "../../src/renderer/components/EnsembleWorkspace/EnsembleWorkspace";
import type { EnsembleSnapshot } from "../../src/shared/ensemble";

function Preview() {
	const [ready, setReady] = useState(false);
	const [snapshot, setSnapshot] = useState<EnsembleSnapshot>({
		groups: [],
		sessions: [],
	});
	const [workspaces, setWorkspaces] = useState<
		{ id: string; name: string; project: string }[]
	>([]);
	const [error, setError] = useState("");
	const [conversation, setConversation] = useState<{
		title: string;
		messages: { id: string; kind: string; text: string }[];
	} | null>(null);
	const refresh = useCallback(async () => {
		try {
			const r = await fetch("/snapshot");
			if (!r.ok)
				throw new Error(
					"Live connection unavailable. The group journal is preserved.",
				);
			const data = await r.json();
			setSnapshot(data);
			setWorkspaces(data.workspaces);
			setReady(true);
			setError("");
		} catch (e) {
			setError(String(e));
		}
	}, []);
	useEffect(() => {
		document.title = "Flock — GatedSpace";
		void refresh();
		const timer = setInterval(() => {
			if (!document.hidden) void refresh();
		}, 2000);
		return () => clearInterval(timer);
	}, [refresh]);
	async function command<T>(action: string, input: unknown): Promise<T> {
		const response = await fetch("/command", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ action, input }),
		});
		const result = await response.json();
		if (!response.ok) throw new Error(result.error);
		await refresh();
		return result.value;
	}
	if (!ready)
		return (
			<output style={{ padding: 20 }}>{error || "Opening Flock..."}</output>
		);
	return (
		<>
			{error && (
				<div role="alert" style={{ padding: 12, color: "#ff9da9" }}>
					{error}
				</div>
			)}
			<EnsembleWorkspace
				snapshot={snapshot}
				workspaces={workspaces}
				evidenceLabel="Live native sessions · development bridge"
				actions={{
					create: (input) => command("create", input),
					control: (id, action) => command("control", { id, action }),
					message: (id, to, text) => command("message", { id, to, text }),
					update: (id, input) => command("update", { id, ...input }),
					resolve: (id, messageId, retry) =>
						command("resolve", { id, messageId, retry }),
					addMember: (id, member) => command("addMember", { id, member }),
					removeMember: (id, memberId) =>
						command("removeMember", { id, memberId }),
					createSession: (provider, workspaceId) =>
						command("createSession", { provider, workspaceId }),
					openSession: (member) => {
						void command<{
							title: string;
							messages: { id: string; kind: string; text: string }[];
						}>("conversation", { key: member.key, provider: member.provider })
							.then(setConversation)
							.catch((e) => setError(String(e)));
					},
				}}
			/>
			{conversation && (
				<dialog
					open
					style={{
						position: "fixed",
						inset: "5%",
						zIndex: 20,
						width: "90%",
						height: "90%",
						background: "#22232e",
						color: "#f0edf6",
						border: "1px solid #585565",
						borderRadius: 14,
						padding: 24,
						overflow: "auto",
					}}
				>
					<button
						type="button"
						onClick={() => setConversation(null)}
						style={{ float: "right" }}
					>
						Close conversation
					</button>
					<h2>{conversation.title} · native transcript</h2>
					{conversation.messages
						.filter((m) => m.kind === "user" || m.kind === "assistant")
						.map((m) => (
							<section key={m.id} style={{ marginTop: 20 }}>
								<strong>{m.kind}</strong>
								<pre
									style={{
										whiteSpace: "pre-wrap",
										overflowWrap: "anywhere",
										font: "12px/1.6 Segoe UI",
									}}
								>
									{m.text}
								</pre>
							</section>
						))}
				</dialog>
			)}
		</>
	);
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<Preview />);
