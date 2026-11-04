import { Component, type ReactNode } from "react";

/** A Flock render failure must not take down the surrounding sessions. */
export class EnsembleErrorBoundary extends Component<
	{ children: ReactNode },
	{ error: Error | null }
> {
	state: { error: Error | null } = { error: null };
	static getDerivedStateFromError(error: Error) {
		return { error };
	}
	render() {
		if (!this.state.error) return this.props.children;
		return (
			<div className="flex flex-1 min-w-0 flex-col items-center justify-center gap-3 p-6 select-text cursor-text">
				<p role="alert">Flock couldn't display this view.</p>
				<p className="text-muted-foreground break-all">
					{this.state.error.message}
				</p>
				<button
					type="button"
					className="rounded-md border px-3 py-2"
					onClick={() => this.setState({ error: null })}
				>
					Try again
				</button>
			</div>
		);
	}
}
