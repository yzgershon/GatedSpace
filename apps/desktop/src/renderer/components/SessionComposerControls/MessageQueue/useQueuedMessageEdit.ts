import { useRef, useState, useSyncExternalStore } from "react";
import type { QueuedPrompt } from "shared/session-queue";
import type { useMessageQueue } from "./useMessageQueue";

interface Edit {
	id: string;
	backup: QueuedPrompt;
	resume: boolean;
	pauseVersion: number;
}
// Keep the edit and the unsent draft when a pane is temporarily unmounted.
const edits = new Map<string, Edit>();
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
	listeners.add(fn);
	return () => {
		listeners.delete(fn);
	};
};
function update(key: string, edit?: Edit) {
	if (edit) edits.set(key, edit);
	else edits.delete(key);
	for (const listener of listeners) listener();
}

export function useQueuedMessageEdit({
	key,
	queue,
	read,
	write,
	focus,
}: {
	key: string;
	queue: ReturnType<typeof useMessageQueue>;
	read: () => QueuedPrompt;
	write: (prompt: QueuedPrompt) => void;
	focus: () => void;
}) {
	const edit = useSyncExternalStore(subscribe, () => edits.get(key));
	const [busy, setBusy] = useState(false);
	const locked = useRef(false);
	const current = useRef({ key, read, write, focus });
	current.current = { key, read, write, focus };
	const run = async (action: () => Promise<void>) => {
		if (locked.current) return;
		locked.current = true;
		setBusy(true);
		queue.setError(undefined);
		try {
			await action();
		} catch (error) {
			queue.setError(error instanceof Error ? error.message : String(error));
		} finally {
			locked.current = false;
			setBusy(false);
		}
	};
	return {
		id: edit?.id,
		busy,
		begin: (id: string) =>
			run(async () => {
				if (edits.has(key))
					throw new Error("Save or cancel the current edit first.");
				const held = await queue.beginEdit(id);
				if (current.current.key !== key) {
					if (held.resume) await queue.resume(held.pauseVersion);
					return;
				}
				const { read, write, focus } = current.current;
				update(key, {
					id,
					backup: read(),
					resume: held.resume,
					pauseVersion: held.pauseVersion,
				});
				write(held.entry.prompt);
				requestAnimationFrame(focus);
			}),
		save: (prompt: QueuedPrompt) =>
			run(async () => {
				const held = edits.get(key);
				if (!held) return;
				await queue.replace(held.id, prompt);
				write(held.backup);
				update(key);
				if (held.resume) await queue.resume(held.pauseVersion);
				requestAnimationFrame(focus);
			}),
		cancel: () =>
			run(async () => {
				const held = edits.get(key);
				if (!held) return;
				write(held.backup);
				update(key);
				if (held.resume) await queue.resume(held.pauseVersion);
				requestAnimationFrame(focus);
			}),
	};
}
