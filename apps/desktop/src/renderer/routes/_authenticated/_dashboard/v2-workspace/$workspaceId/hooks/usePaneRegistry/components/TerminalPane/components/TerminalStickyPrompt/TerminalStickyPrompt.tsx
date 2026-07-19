import { cn } from "@superset/ui/utils";
import { useQuery } from "@tanstack/react-query";
import type { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTerminalAgentBinding } from "renderer/hooks/host-service/useTerminalAgentBindings";
import { electronTrpcClient } from "renderer/lib/trpc-client";

/**
 * Sticky "what you asked" bar for agent terminals. While the terminal is
 * scrolled away from the bottom, the latest user message of the Claude/Codex
 * session bound to this terminal pins to the top of the pane — bright text,
 * clamped to 3 lines, click to expand to the full message.
 *
 * The text comes from the agent's on-disk transcript via the main process
 * (context-free proxy client — electronTrpc hooks must not be used inside
 * the workspace tree; see ClaudeSessionsPane).
 */

interface TerminalStickyPromptProps {
	terminal: Terminal | null;
	workspaceId: string;
	terminalId: string;
}

export function TerminalStickyPrompt({
	terminal,
	workspaceId,
	terminalId,
}: TerminalStickyPromptProps) {
	const binding = useTerminalAgentBinding(workspaceId, terminalId);
	const provider =
		binding?.agentId === "claude" || binding?.agentId === "codex"
			? binding.agentId
			: null;
	const sessionId = binding?.agentSessionId ?? null;

	const [scrolledUp, setScrolledUp] = useState(false);
	const [expanded, setExpanded] = useState(false);
	const [clamped, setClamped] = useState(false);
	const textRef = useRef<HTMLSpanElement | null>(null);

	const checkScrollPosition = useCallback(() => {
		if (!terminal) return;
		const buffer = terminal.buffer.active;
		setScrolledUp(buffer.viewportY < buffer.baseY);
	}, [terminal]);

	useEffect(() => {
		if (!terminal) return;
		checkScrollPosition();
		const writeDisposable = terminal.onWriteParsed(checkScrollPosition);
		const scrollDisposable = terminal.onScroll(checkScrollPosition);
		return () => {
			writeDisposable.dispose();
			scrollDisposable.dispose();
		};
	}, [terminal, checkScrollPosition]);

	// Returning to the bottom collapses the bar back to its compact state.
	useEffect(() => {
		if (!scrolledUp) setExpanded(false);
	}, [scrolledUp]);

	const enabled = Boolean(provider && sessionId && scrolledUp);
	const { data } = useQuery({
		queryKey: ["terminal-sticky-prompt", provider, sessionId],
		enabled,
		queryFn: () => {
			if (!provider || !sessionId) return null;
			return electronTrpcClient.claudeSessions.lastUserText.query({
				provider,
				sessionId,
			});
		},
		refetchInterval: enabled ? 5_000 : false,
		staleTime: 4_000,
	});

	const text = data?.text ?? null;

	// Detect whether the 3-line clamp actually cut anything so the "more"
	// affordance only shows when there is more to see.
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-measure per text/visibility change
	useEffect(() => {
		if (expanded) return;
		const el = textRef.current;
		if (!el) {
			setClamped(false);
			return;
		}
		setClamped(el.scrollHeight > el.clientHeight + 1);
	}, [text, expanded, scrolledUp]);

	if (!enabled || !text) return null;

	return (
		<div className="absolute inset-x-0 top-0 z-10 border-b border-border/60 bg-background/90 backdrop-blur-sm">
			<button
				type="button"
				title={
					expanded ? "Collapse" : clamped ? "Show the full message" : undefined
				}
				onClick={() => setExpanded((prev) => !prev)}
				className="flex w-full items-start gap-2 px-3 py-1.5 text-left"
			>
				<span className="mt-px shrink-0 font-mono text-xs font-semibold text-primary">
					❯
				</span>
				<span
					ref={textRef}
					className={cn(
						"min-w-0 flex-1 whitespace-pre-wrap break-words text-xs font-medium leading-relaxed text-foreground",
						expanded
							? "max-h-56 overflow-y-auto chat-scrollbar"
							: "line-clamp-3",
					)}
				>
					{text}
				</span>
				{!expanded && clamped ? (
					<span className="mt-px shrink-0 rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground">
						⋯ more
					</span>
				) : null}
			</button>
		</div>
	);
}
