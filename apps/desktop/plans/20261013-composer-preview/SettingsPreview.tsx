import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
	type ComposerMode,
	SessionComposerSettings,
} from "../../src/renderer/components/SessionComposerControls/SessionComposerSettings";

// The real production menus, with local-only state. No IPC or microphone access.
function SettingsPreview() {
	const [provider, setProvider] = useState("Codex");
	const [model, setModel] = useState("GPT-6 Astra");
	const [mode, setMode] = useState("auto");
	const [effort, setEffort] = useState("xhigh");
	const [fast, setFast] = useState(false);
	useEffect(() => {
		const selector = document.getElementById("provider") as HTMLSelectElement;
		const update = () => {
			setProvider(selector.value);
			setModel(selector.value === "Claude" ? "Claude Opus" : "GPT-6 Astra");
			setMode("auto");
			setEffort(selector.value === "Claude" ? "high" : "xhigh");
			setFast(false);
		};
		selector.addEventListener("change", update);
		return () => selector.removeEventListener("change", update);
	}, []);
	const modes: ComposerMode[] = [
		{ id: "auto", label: "Auto", description: provider === "Claude" ? "Edit automatically; approve commands when needed" : "Work with approval when needed" },
		{ id: "plan", label: "Plan", description: "Think through the approach first", kind: "plan" },
		{ id: "full", label: "Full access", description: "Work without approval prompts", kind: "full" },
		provider === "Claude" ? { id: "manual", label: "Manual", description: "Approve each edit and command" } : { id: "read-only", label: "Read only", description: "Explore without editing files" },
	];
	const props = {
		provider, model, onModelChange: setModel,
		models: (provider === "Claude" ? ["Claude Opus", "Claude Sonnet", "Claude Haiku"] : ["GPT-6 Astra", "GPT-6 Luna"]).map(name => ({ id: name, name })),
		mode, modes, onModeChange: setMode, effort,
		efforts: provider === "Claude" ? ["low", "medium", "high", "max"] : ["low", "medium", "high", "xhigh"],
		onEffortChange: setEffort, fast, onFastChange: setFast,
	};
	return <>
		<SessionComposerSettings {...props} section="model" />
		<SessionComposerSettings {...props} section="permissions" />
	</>;
}

const mount = document.getElementById("settings-controls");
if (mount) createRoot(mount).render(<SettingsPreview />);
