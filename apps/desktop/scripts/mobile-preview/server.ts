import { MOBILE_BRIDGE_HTML } from "../../src/main/lib/mobile-bridge/client-html";
import type { MobileMessage } from "../../src/main/lib/mobile-bridge/session-contract";
import { builtInThemes } from "../../src/shared/themes/built-in";

const pixel =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/8P8AAAAASUVORK5CYII=";
const snapshots: Record<
	string,
	{
		provider: string;
		title: string;
		working: boolean;
		questions: unknown[];
		context?: { contextTokens: number; contextWindow: number };
		hasEarlier: boolean;
		messages: MobileMessage[];
	}
> = {
	codex: {
		provider: "codex",
		title: "GatedSpace",
		working: true,
		questions: [
			{
				id: "q1",
				title: "Preview preference",
				questions: [
					{
						id: "layout",
						question: "Which layout should I use?",
						options: ["Compact", "Comfortable"],
					},
				],
			},
		],
		context: { contextTokens: 34000, contextWindow: 128000 },
		hasEarlier: true,
		messages: [
			{
				id: "c1",
				kind: "user",
				text: "Make the mobile app feel polished, and let me continue my Codex sessions from my phone.",
				images: [{ name: "Layout reference", source: pixel }],
			},
			{
				id: "c2",
				kind: "assistant",
				text: "I’ll check the session connection and improve the phone layout. Your conversation will stay visible while the connection recovers.",
			},
			{
				id: "c3",
				kind: "activity",
				title: "Read mobile session routes",
				text: "Read session-api.ts\nChecked request validation, history pagination, and question responses.",
			},
			{
				id: "c4",
				kind: "assistant",
				text: "Claude and Codex now share the same mobile controls. I’m checking that switching conversations preserves each draft.",
			},
		],
	},
	claude: {
		provider: "claude",
		title: "Filtrsoft",
		working: false,
		questions: [],
		hasEarlier: false,
		messages: [
			{ id: "a1", kind: "user", text: "Check the project status." },
			{
				id: "a2",
				kind: "assistant",
				text: "The current changes are ready to review. What would you like to work on next?",
			},
		],
	},
};
const initialSnapshots = JSON.stringify(snapshots);
const received: unknown[] = [];
Bun.serve({
	hostname: "127.0.0.1",
	port: Number(process.env.MOBILE_PREVIEW_PORT || 52132),
	async fetch(req) {
		const url = new URL(req.url),
			path = url.pathname;
		if (path === "/preview")
			return new Response(
				'<html><title>GatedSpace mobile preview</title><body style="margin:0;background:#19191e;color:#eee;font:15px system-ui;display:grid;place-items:center;min-height:100vh"><div><p>GatedSpace · Mobile preview · Simulated sessions</p><iframe title="Phone preview" src="/?t=preview-token" style="width:390px;height:780px;max-height:88vh;border:1px solid #454550;border-radius:24px"></iframe></div></body></html>',
				{ headers: { "Content-Type": "text/html" } },
			);
		if (!path.startsWith("/api"))
			return new Response(
				MOBILE_BRIDGE_HTML.replaceAll("__PAGE_VERSION__", "1.4.0-preview"),
				{
					headers: { "Content-Type": "text/html", "Cache-Control": "no-store" },
				},
			);
		if (req.headers.get("x-bridge-token") !== "preview-token")
			return Response.json({ error: "unauthorized" }, { status: 401 });
		if (path === "/api/themes")
			return Response.json({
				themes: builtInThemes.filter((t) => t.id.includes("dracula")),
			});
		if (path === "/api/mobile/usage/codex")
			return Response.json({
				window: {
					description: "weekly window",
					usedPercent: 24,
					resets: "Friday",
				},
			});
		if (path === "/api/usage")
			return Response.json({
				accounts: [{ label: "Claude", limits: { fiveHourPercent: 12 } }],
			});
		if (path === "/api/workspaces")
			return Response.json({
				workspaces: [{ id: "workspace", name: "local", project: "GatedSpace" }],
			});
		if (path === "/api/mobile/sessions")
			return Response.json({
				sessions: [
					{
						key: "codex",
						provider: "codex",
						title: "GatedSpace mobile",
						sessionId: "codex-thread",
						running: true,
					},
					{
						key: "claude",
						provider: "claude",
						title: "Filtrsoft",
						sessionId: "claude-thread",
						running: false,
					},
				],
				history: [
					{
						sessionId: "saved",
						provider: "codex",
						title: "Saved Codex conversation",
					},
				],
				warnings: [],
			});
		if (path === "/api/mobile/resume" || path === "/api/mobile/new") {
			const b = await req.json();
			return Response.json({ key: b.provider, provider: b.provider });
		}
		if (path === "/api/preview/reset") {
			Object.assign(snapshots, JSON.parse(initialSnapshots));
			received.length = 0;
			return Response.json({ ok: true });
		}
		if (path === "/api/preview/received") return Response.json(received);
		const match =
			/^\/api\/mobile\/(codex|claude)\/[^/]+(?:\/(send|stop|answer))?$/.exec(
				path,
			);
		if (match) {
			const data = snapshots[match[1] as keyof typeof snapshots];
			if (match[2]) {
				const body = await req.json();
				received.push({ provider: match[1], action: match[2], body });
				if (match[2] === "stop") data.working = false;
				if (match[2] === "answer") data.questions = [];
				if (match[2] === "send")
					data.messages.push({
						id: crypto.randomUUID(),
						kind: "user",
						text: body.text,
						images: (body.images || []).map(
							(i: { name: string; mediaType: string; data: string }) => ({
								name: i.name,
								source: `data:${i.mediaType};base64,${i.data}`,
							}),
						),
					});
				return Response.json({ ok: true });
			}
			if (url.searchParams.has("before"))
				return Response.json({
					...data,
					messages: Array.from({ length: 20 }, (_, i) => ({
						id: `older${i}`,
						kind: i % 2 ? "assistant" : "user",
						text: `Earlier conversation message ${i}`,
					})),
					hasEarlier: false,
				});
			return Response.json(data);
		}
		return Response.json(
			{ error: "Preview route unavailable" },
			{ status: 404 },
		);
	},
});
console.log(
	`Mobile preview ready on http://127.0.0.1:${process.env.MOBILE_PREVIEW_PORT || 52132}/preview`,
);
