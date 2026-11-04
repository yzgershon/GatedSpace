import { lazy, type ReactNode, Suspense, useEffect, useState } from "react";
import { EnsembleErrorBoundary } from "renderer/components/EnsembleWorkspace/EnsembleErrorBoundary";
import { useFlockNavigation } from "renderer/components/EnsembleWorkspace/flock-navigation";
import { HotkeyScope } from "renderer/hotkeys/HotkeyScope";

const EnsemblePanel = lazy(() =>
	import("renderer/components/EnsembleWorkspace/EnsemblePanel").then(
		(module) => ({
			default: module.EnsemblePanel,
		}),
	),
);

/** Keep panes and the Flock draft alive while switching between the two views. */
export function DashboardContent({ children }: { children: ReactNode }) {
	const flock = useFlockNavigation();
	const [visited, setVisited] = useState(false);
	useEffect(() => {
		if (flock.open) setVisited(true);
	}, [flock.open]);
	return (
		<div className="relative flex flex-1 min-h-0 min-w-0">
			<div
				className="flex flex-1 min-h-0 min-w-0"
				style={{ visibility: flock.open ? "hidden" : undefined }}
				aria-hidden={flock.open || undefined}
				inert={flock.open}
			>
				<HotkeyScope enabled={!flock.open}>{children}</HotkeyScope>
			</div>
			{(flock.open || visited) && (
				<section
					aria-label="Flock workspace"
					aria-hidden={!flock.open || undefined}
					inert={!flock.open}
					className="absolute inset-0 flex min-h-0 min-w-0 overflow-hidden"
					style={{ visibility: flock.open ? undefined : "hidden" }}
				>
					<EnsembleErrorBoundary>
						<Suspense
							fallback={<output className="p-6">Opening Flock…</output>}
						>
							<EnsemblePanel active={flock.open} />
						</Suspense>
					</EnsembleErrorBoundary>
				</section>
			)}
		</div>
	);
}
