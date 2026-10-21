import { Mic, Square } from "lucide-react";
import {
	type Dispatch,
	type RefObject,
	type SetStateAction,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { insertDictation } from "./insert-dictation";

export function FlowMicrophone({
	paneId,
	textarea,
	onText,
	onError,
}: {
	paneId: string;
	textarea: RefObject<HTMLTextAreaElement | null>;
	onText: Dispatch<SetStateAction<string>>;
	onError: (error: string) => void;
}) {
	const [state, setState] = useState<
		"idle" | "starting" | "recording" | "transcribing"
	>("idle");
	const active = useRef(false);
	const mounted = useRef(true);
	const saved = useRef({ text: "", start: 0, end: 0 });
	const latest = useRef({ onText, onError });
	latest.current = { onText, onError };
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			if (active.current)
				void electronTrpcClient.flowDictation.cancel
					.mutate({ key: paneId })
					.catch(() => {});
		};
	}, [paneId]);
	const stop = useCallback(async () => {
		setState("transcribing");
		try {
			const result = await electronTrpcClient.flowDictation.stop.mutate({
				key: paneId,
			});
			if (mounted.current) {
				latest.current.onText((current) =>
					insertDictation(current, saved.current, result.text),
				);
				textarea.current?.focus();
			}
		} catch (error) {
			if (mounted.current)
				latest.current.onError(
					error instanceof Error ? error.message : String(error),
				);
		} finally {
			active.current = false;
			if (mounted.current) setState("idle");
		}
	}, [paneId, textarea]);
	useEffect(() => {
		if (state !== "recording") return;
		const timer = setTimeout(() => void stop(), 3 * 60_000);
		return () => clearTimeout(timer);
	}, [state, stop]);
	const click = async () => {
		if (state === "recording") return stop();
		if (active.current) return;
		const input = textarea.current;
		if (!input) return;
		saved.current = {
			text: input.value,
			start: input.selectionStart,
			end: input.selectionEnd,
		};
		active.current = true;
		setState("starting");
		try {
			await electronTrpcClient.flowDictation.start.mutate({ key: paneId });
			if (mounted.current) setState("recording");
			else
				await electronTrpcClient.flowDictation.cancel.mutate({ key: paneId });
		} catch (error) {
			active.current = false;
			if (mounted.current) {
				setState("idle");
				latest.current.onError(
					error instanceof Error ? error.message : String(error),
				);
			}
		}
	};
	const label =
		state === "idle"
			? "Start Flow dictation"
			: state === "recording"
				? "Finish Flow dictation"
				: state === "starting"
					? "Opening Flow"
					: "Transcribing with Flow";
	return (
		<button
			type="button"
			className="session-settings-icon session-flow-mic"
			data-recording={state === "recording"}
			aria-label={label}
			title={label}
			aria-pressed={state === "recording"}
			disabled={state === "starting" || state === "transcribing"}
			onPointerDown={(e) => e.preventDefault()}
			onClick={() => void click()}
		>
			{state === "recording" ? (
				<Square size={17} fill="currentColor" />
			) : (
				<Mic size={24} />
			)}
			{state !== "idle" && (
				<output className="session-flow-status">
					{state === "recording" ? "Flow · listening" : label}
				</output>
			)}
		</button>
	);
}
