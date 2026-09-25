import { Popover, PopoverContent, PopoverTrigger } from "@superset/ui/popover";
import { Monitor, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import {
	COMPUTER_STOP_LABEL,
	type ComputerUseState,
} from "shared/computer-use";
import "./computer-control.css";

export function ComputerControl({ paneId }: { paneId: string }) {
	const [state, setState] = useState<ComputerUseState>({ phase: "off" });
	const [error, setError] = useState("");
	useEffect(() => {
		const subscription =
			electronTrpcClient.codexSession.computerStream.subscribe(undefined, {
				onData: setState,
				onError: (e) => setError(e.message),
			});
		return () => subscription.unsubscribe();
	}, []);
	const active = ["ready", "connecting", "stopping"].includes(state.phase);
	const mine = state.owner === `codex:${paneId}`;
	const stop = async () => {
		setError("");
		try {
			setState(await electronTrpcClient.codexSession.computerStop.mutate());
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	};
	return (
		<div className="computer-control" data-active={active}>
			<Popover>
				<PopoverTrigger asChild>
					<button
						type="button"
						className="session-attach computer-control-trigger"
						aria-label="Computer control"
						title="Computer control"
						aria-pressed={active && mine}
					>
						<Monitor size={18} />
					</button>
				</PopoverTrigger>
				<PopoverContent
					side="top"
					align="start"
					className="computer-control-panel"
				>
					<strong>Computer control</strong>
					<p>
						Let this Codex pane see your desktop and use the mouse and keyboard
						through Windows-MCP.
					</p>
					<p className="computer-control-hint">
						Windows must stay unlocked. Control turns off on restart, sleep, or
						lock.
					</p>
					{(error || state.error) && (
						<p
							role="alert"
							className="select-text cursor-text computer-control-error"
						>
							{error || state.error}
						</p>
					)}
					{active ? (
						<>
							<output>
								{state.phase === "connecting"
									? "Preparing the Windows controller… First setup may take a few minutes."
									: state.phase === "stopping"
										? "Stopping computer control…"
										: mine
											? "Enabled for this pane"
											: "Enabled in another pane"}
							</output>
							<button
								type="button"
								className="computer-control-action"
								onClick={() => void stop()}
								disabled={state.phase === "stopping"}
							>
								Stop computer control
							</button>
						</>
					) : (
						<button
							type="button"
							className="computer-control-action"
							onClick={async () => {
								setError("");
								try {
									setState(
										await electronTrpcClient.codexSession.computerEnable.mutate(
											{ key: paneId },
										),
									);
								} catch (e) {
									setError(e instanceof Error ? e.message : String(e));
								}
							}}
						>
							Enable for this pane
						</button>
					)}
					<small>
						Stop anytime: <kbd>{COMPUTER_STOP_LABEL}</kbd>
					</small>
				</PopoverContent>
			</Popover>
			{active && (
				<output className="computer-control-live">
					<span>
						{state.phase === "connecting"
							? "Connecting…"
							: state.phase === "stopping"
								? "Stopping…"
								: mine
									? state.activity
										? `Computer · ${state.activity}`
										: "Computer ready"
									: "Computer in use"}
					</span>
					<button
						type="button"
						aria-label="Stop computer control"
						title={`Stop computer control (${COMPUTER_STOP_LABEL})`}
						onClick={() => void stop()}
						disabled={state.phase === "stopping"}
					>
						<Square size={12} fill="currentColor" />
					</button>
				</output>
			)}
		</div>
	);
}
