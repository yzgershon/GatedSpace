import type {
	ComputerPointer,
	ComputerUseState,
} from "../../../shared/computer-use";

type Listener = (point: ComputerPointer | null) => void;
interface Source {
	get(): ComputerUseState;
	on(event: "change", listener: () => void): unknown;
	off(event: "change", listener: () => void): unknown;
}

/** One shared, movement-only 20Hz reader for all monitors; zero work at rest. */
export class ComputerPointerTracker {
	private listeners = new Set<Listener>();
	private latest: ComputerPointer | null = null;
	private timer?: ReturnType<typeof setInterval>;
	constructor(
		private source: Source,
		private read: () => ComputerPointer,
		private timers = { set: setInterval, clear: clearInterval },
	) {}
	private publish(point: ComputerPointer | null) {
		this.latest = point;
		for (const listener of this.listeners) listener(point);
	}
	private sample = () => {
		const next = this.read(),
			old = this.latest;
		if (
			!old ||
			next.x !== old.x ||
			next.y !== old.y ||
			next.displayX !== old.displayX ||
			next.displayY !== old.displayY
		)
			this.publish(next);
	};
	private update = () => {
		const state = this.source.get();
		if (state.phase === "ready" && state.activity && this.listeners.size) {
			if (!this.timer) {
				this.sample();
				this.timer = this.timers.set(this.sample, 50);
				this.timer.unref?.();
			}
		} else {
			this.timers.clear(this.timer);
			this.timer = undefined;
			if (this.latest) this.publish(null);
		}
	};
	subscribe(listener: Listener) {
		const first = this.listeners.size === 0;
		this.listeners.add(listener);
		listener(this.latest);
		if (first) {
			this.source.on("change", this.update);
			this.update();
		}
		return () => {
			this.listeners.delete(listener);
			if (!this.listeners.size) {
				this.source.off("change", this.update);
				this.timers.clear(this.timer);
				this.timer = undefined;
				this.latest = null;
			}
		};
	}
}
