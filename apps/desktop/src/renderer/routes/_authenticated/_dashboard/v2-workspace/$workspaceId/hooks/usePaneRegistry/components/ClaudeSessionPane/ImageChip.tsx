/**
 * An attached image, shown as a preview you can open.
 *
 * A filename and a pixel count tell you an image is there; they don't tell you
 * WHICH screenshot, which is the only thing anyone actually wants when scrolling
 * back. So this shows the picture, and clicking it opens the full size.
 *
 * Falls back to the old name-and-dimensions chip when there's no preview —
 * transcripts loaded from disk record that an image was attached but not how it
 * looked, and a broken thumbnail would be worse than a label.
 */
import { cn } from "@superset/ui/utils";
import { ImageIcon, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { UserAttachment } from "shared/claude-session/events";

/** Full-size view. Click anywhere, or press Escape, to dismiss. */
function Lightbox({
	source,
	name,
	onClose,
}: {
	source: string;
	name: string;
	onClose: () => void;
}) {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onClose]);

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-8">
			{/*
			 * The backdrop is a real button, not a div with a click handler. It has
			 * to be reachable and dismissable from the keyboard, and giving it the
			 * right element is less work than explaining away the lint rule.
			 */}
			<button
				type="button"
				aria-label="Close image"
				onClick={onClose}
				className="absolute inset-0 cursor-default bg-black/70"
			/>
			<img
				src={source}
				alt={name}
				className="pointer-events-none relative max-h-full max-w-full rounded-lg object-contain shadow-2xl"
			/>
			<button
				type="button"
				aria-label="Close"
				onClick={onClose}
				className="absolute top-4 right-4 flex size-8 items-center justify-center rounded-md bg-black/50 text-white transition-colors hover:bg-black/70"
			>
				<X className="size-4" />
			</button>
		</div>
	);
}

export function ImageChip({
	attachment,
	/** Full-resolution source, when the sender still has it in hand. */
	fullSource,
	onRemove,
	className,
}: {
	attachment: UserAttachment;
	fullSource?: string;
	onRemove?: () => void;
	className?: string;
}) {
	const [open, setOpen] = useState(false);
	const preview = attachment.thumbnail;
	// Prefer the full image when it's available (the composer has it); the
	// preview is enough to open otherwise.
	const expanded = fullSource ?? preview;

	if (!preview) {
		return (
			<span
				className={cn(
					"flex items-center gap-1.5 rounded-md border border-border bg-tertiary px-2 py-0.5 text-[11.5px]",
					className,
				)}
			>
				<ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />
				<span className="max-w-48 truncate text-muted-foreground">
					{attachment.name}
				</span>
				{attachment.width && attachment.height ? (
					<span className="tabular-nums text-muted-foreground/60">
						{attachment.width}×{attachment.height}
					</span>
				) : null}
				{onRemove ? (
					<button
						type="button"
						aria-label={`Remove ${attachment.name}`}
						onClick={onRemove}
						className="text-muted-foreground transition-colors hover:text-foreground"
					>
						<X className="size-3" />
					</button>
				) : null}
			</span>
		);
	}

	return (
		<>
			<span className={cn("group relative inline-block", className)}>
				<button
					type="button"
					onClick={() => setOpen(true)}
					title={`${attachment.name}${
						attachment.width && attachment.height
							? ` · ${attachment.width}×${attachment.height}`
							: ""
					}`}
					className="block overflow-hidden rounded-md border border-border transition-colors hover:border-muted-foreground/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
				>
					<img
						src={preview}
						alt={attachment.name}
						// Capped rather than natural size, so a tall screenshot can't push
						// the prompt off the screen it's meant to head.
						className="max-h-24 max-w-56 object-cover"
					/>
				</button>
				{onRemove ? (
					<button
						type="button"
						aria-label={`Remove ${attachment.name}`}
						onClick={onRemove}
						className="-top-1.5 -right-1.5 absolute flex size-5 items-center justify-center rounded-full border border-border bg-popover text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
					>
						<X className="size-3" />
					</button>
				) : null}
			</span>
			{open && expanded ? (
				<Lightbox
					source={expanded}
					name={attachment.name}
					onClose={() => setOpen(false)}
				/>
			) : null}
		</>
	);
}
