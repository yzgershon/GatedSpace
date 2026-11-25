import { MOBILE_BRIDGE_HTML } from "../../src/main/lib/mobile-bridge/client-html";
import {
	type HubState,
	MobileHubStore,
} from "../../src/main/lib/mobile-bridge/hub-store";
import { mobileMarkdown } from "../../src/main/lib/mobile-bridge/message-format";
import { MOBILE_BRIDGE_PAGE_VERSION } from "../../src/main/lib/mobile-bridge/pwa-assets";
import type { MobileMessage } from "../../src/main/lib/mobile-bridge/session-contract";
import { messagePage } from "../../src/main/lib/mobile-bridge/session-contract";
import { builtInThemes } from "../../src/shared/themes/built-in";
import { MOBILE_PREVIEW_SHELL } from "./preview-shell";

const pixel =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/8P8AAAAASUVORK5CYII=";
const snapshots: Record<
	string,
	{
		provider: string;
		sessionId: string;
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
		sessionId: "codex-thread",
		title: "GatedSpace",
		working: true,
		questions: [],
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
		sessionId: "claude-thread",
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
	yuta: {
		provider: "claude",
		sessionId: "yuta-thread",
		title: "Yuta",
		working: true,
		questions: [],
		hasEarlier: false,
		messages: [
			{
				id: "y1",
				kind: "user",
				text: "Can we make the welcome screen feel a little more personal?",
			},
			{
				id: "y2",
				kind: "assistant",
				text: "Yes. I’ll start with a calmer greeting and keep your recent work within reach.",
			},
			{
				id: "y3",
				kind: "assistant",
				text: "I’m checking how it feels on a smaller screen, too.",
			},
		],
	},
};
const initialSnapshots = JSON.stringify(snapshots);
const received: unknown[] = [];
let hubState: HubState | null = null;
let hub = new MobileHubStore({
	load: async () => hubState,
	save: async (state) => {
		hubState = state;
	},
});
Bun.serve({
	hostname: "127.0.0.1",
	port: Number(process.env.MOBILE_PREVIEW_PORT || 52132),
	async fetch(req) {
		const url = new URL(req.url),
			path = url.pathname;
		if (path === "/preview")
			return new Response(MOBILE_PREVIEW_SHELL, {
				headers: { "Content-Type": "text/html" },
			});
		if (path === "/icon.png")
			return new Response(
				Bun.file(
					new URL("../../src/resources/build/icons/icon.png", import.meta.url),
				),
			);
		if (!path.startsWith("/api"))
			return new Response(
				MOBILE_BRIDGE_HTML.replaceAll(
					"__PAGE_VERSION__",
					`${MOBILE_BRIDGE_PAGE_VERSION}-preview`,
				),
				{
					headers: { "Content-Type": "text/html", "Cache-Control": "no-store" },
				},
			);
		if (req.headers.get("x-bridge-token") !== "preview-token")
			return Response.json({ error: "unauthorized" }, { status: 401 });
		if (path.startsWith("/api/mobile/hub")) {
			try {
				if (path === "/api/mobile/hub/references" && req.method === "POST")
					return Response.json(await hub.resolveReference(await req.json()));
				if (path === "/api/mobile/hub")
					return Response.json({
						...(await hub.list()),
						execution: "desktop",
						cloudAvailable: false,
					});
				const match =
					/^\/api\/mobile\/hub\/(channels|tasks|outputs)(?:\/([^/]+))?$/.exec(
						path,
					);
				if (!match)
					return Response.json({ error: "Not found" }, { status: 404 });
				const kind = match[1] as "channels" | "tasks" | "outputs";
				if (req.method === "GET" && kind === "outputs") {
					const item = await hub.get("outputs", match[2]);
					return Response.json({ ...item, html: mobileMarkdown(item.body) });
				}
				const { expectedVersion, ...data } = await req.json();
				return Response.json(
					await hub.write(
						kind,
						match[2] ? { ...data, id: match[2] } : data,
						req.method === "PATCH" ? expectedVersion : undefined,
					),
				);
			} catch (error) {
				return Response.json(
					{ error: error instanceof Error ? error.message : "Failed" },
					{ status: 409 },
				);
			}
		}
		if (path === "/api/themes")
			return Response.json({
				themes: [
					...builtInThemes.filter((t) => t.id.includes("dracula")),
					...builtInThemes.filter((t) => !t.id.includes("dracula")),
				],
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
		if (path === "/api/mobile/computer")
			return Response.json({
				name: "Your desktop",
				platform: "win32",
				connected: true,
				execution: "desktop",
				browserHandoff: false,
				cloudAvailable: false,
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
						lastModified: Date.now() - 60_000,
					},
					{
						key: "yuta",
						provider: "claude",
						title: "Yuta",
						sessionId: "yuta-thread",
						running: true,
						lastModified: Date.now() - 120_000,
					},
					{
						key: "claude",
						provider: "claude",
						title: "Filtrsoft",
						sessionId: "claude-thread",
						running: false,
						lastModified: Date.now() - 3_600_000,
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
			hubState = null;
			hub = new MobileHubStore({
				load: async () => hubState,
				save: async (state) => {
					hubState = state;
				},
			});
			Object.assign(snapshots, JSON.parse(initialSnapshots));
			received.length = 0;
			return Response.json({ ok: true });
		}
		if (path === "/api/preview/received") return Response.json(received);
		if (path === "/api/preview/state" && req.method === "POST") {
			const body = await req.json();
			Object.assign(snapshots[body.provider], body.state);
			return Response.json({ ok: true });
		}
		const imageMatch =
			/^\/api\/mobile\/(codex|claude)\/[^/]+\/image\/([^/]+)\/(\d+)$/.exec(
				path,
			);
		if (imageMatch) {
			const item = snapshots[imageMatch[1]].messages.find(
				(i) => i.id === decodeURIComponent(imageMatch[2]),
			);
			return Response.json(
				item?.images?.[Number(imageMatch[3])] ?? {
					source: pixel,
					name: "Attached image",
				},
			);
		}
		const activityMatch =
			/^\/api\/mobile\/(codex|claude)\/[^/]+\/activity\/([^/]+)$/.exec(path);
		if (activityMatch) {
			const item = snapshots[activityMatch[1]].messages.find(
				(i) => i.id === decodeURIComponent(activityMatch[2]),
			);
			return Response.json({ text: item?.text || "Fixture activity" });
		}
		const match =
			/^\/api\/mobile\/(codex|claude)\/[^/]+(?:\/(send|stop|answer))?$/.exec(
				path,
			);
		if (match) {
			const data = snapshots[path.split("/")[4] === "yuta" ? "yuta" : match[1]];
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
			if (url.searchParams.has("before") && data.messages.length <= 60)
				return Response.json({
					...data,
					messages: Array.from({ length: 20 }, (_, i) => ({
						id: `older${i}`,
						kind: i % 2 ? "assistant" : "user",
						text: `Earlier conversation message ${i}`,
					})),
					hasEarlier: false,
				});
			const page = messagePage(
				data.messages,
				url.searchParams.get("before") ?? undefined,
			);
			return Response.json({
				...data,
				hasEarlier: page.hasEarlier || data.hasEarlier,
				messages: page.messages.map((item) => ({
					...item,
					...(item.kind === "assistant"
						? { html: mobileMarkdown(item.text) }
						: {}),
					...(item.kind === "activity"
						? { text: "", detailAvailable: true }
						: {}),
					images: item.images?.map((image, index) => ({
						name: image.name,
						index,
					})),
				})),
			});
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
