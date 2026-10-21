/** Reattach after IPC errors, replaying pending work through the subscription. */
export function reconnectingSubscription<T>(
	subscribe: (observer: {
		onData: (value: T) => void;
		onError: (error: unknown) => void;
	}) => { unsubscribe(): void },
	onData: (value: T) => void | Promise<void>,
	delay = 500,
) {
	let stopped = false;
	let attempts = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let current: { unsubscribe(): void } | undefined;
	const connect = () => {
		if (stopped) return;
		const retry = () => {
			if (stopped || timer) return;
			timer = setTimeout(
				() => {
					timer = undefined;
					current?.unsubscribe();
					connect();
				},
				Math.min(10_000, delay * 2 ** Math.min(attempts++, 5)),
			);
		};
		try {
			current = subscribe({
				onData: (value) => {
					if (!stopped) {
						attempts = 0;
						try {
							void Promise.resolve(onData(value)).catch(retry);
						} catch {
							retry();
						}
					}
				},
				onError: retry,
			});
		} catch {
			retry();
		}
	};
	connect();
	return () => {
		stopped = true;
		clearTimeout(timer);
		current?.unsubscribe();
	};
}
