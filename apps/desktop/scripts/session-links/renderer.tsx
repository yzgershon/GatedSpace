import { Toaster } from "@superset/ui/sonner";
import { createRoot } from "react-dom/client";
import { CommentMarkdown } from "../../src/renderer/components/CommentMarkdown/CommentMarkdown";
import { MarkdownRenderer } from "../../src/renderer/components/MarkdownRenderer/MarkdownRenderer";
import { DictationFixture } from "./DictationFixture";
import "../../src/renderer/globals.css";
import "../../src/renderer/components/CodexSession/codex-session.css";

document.documentElement.classList.add("dark");
document.documentElement.style.setProperty("--primary", "#ff79c6");
document.documentElement.style.setProperty("--background", "#282a36");
document.documentElement.style.setProperty("--foreground", "#f8f8f2");
document.body.innerHTML = '<main id="root"></main>';
const content =
	"[Open report](<C:/Dev/My report.md:12>) · [Website](https://example.com)\n\n[Blocked](javascript:alert%281%29)";
const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(
	<>
		<section
			data-testid="codex"
			className="codex-assistant-message"
			style={{ padding: 24 }}
		>
			<h2>Codex</h2>
			<CommentMarkdown body={content} />
		</section>
		<section data-testid="claude">
			<h2>Claude</h2>
			<MarkdownRenderer content={content} />
		</section>
		<Toaster />
		<DictationFixture />
	</>,
);
