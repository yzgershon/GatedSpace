import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@superset/ui/dialog";
import { ArrowLeft, ArrowRight, Check, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { releaseHighlightsFor } from "shared/release-highlights";
import { ReleaseArtwork } from "../ReleaseArtwork/ReleaseArtwork";
import "./release-gallery.css";

export function ReleaseGallery({
	open,
	onOpenChange,
	version,
	entries,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	version: string;
	entries: ReturnType<typeof releaseHighlightsFor>;
}) {
	const cards = [...entries]
		.reverse()
		.flatMap((entry) =>
			entry.changes.map((change) => ({ ...change, version: entry.version })),
		);
	const [index, setIndex] = useState(0);
	const [details, setDetails] = useState(false);
	useEffect(() => {
		if (open) {
			setIndex(0);
			setDetails(false);
		}
	}, [open]);
	const selected = Math.min(index, Math.max(0, cards.length - 1));
	const card = cards[selected];
	const select = (next: number) => {
		setIndex(Math.max(0, Math.min(cards.length - 1, next)));
		setDetails(false);
	};
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="release-gallery"
				onKeyDown={(event) => {
					if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
						event.preventDefault();
						select(selected + (event.key === "ArrowRight" ? 1 : -1));
					}
				}}
			>
				<header className="release-heading">
					<span className="release-mark">
						<Sparkles size={16} aria-hidden />
					</span>
					<div>
						<DialogTitle className="release-title">What’s new</DialogTitle>
						<DialogDescription className="release-version">
							GatedSpace {version}
						</DialogDescription>
					</div>
				</header>
				{card ? (
					<div className="release-scroll">
						<article
							key={`${card.version}-${card.title}`}
							className="release-slide"
							aria-live="polite"
							aria-atomic="true"
						>
							<ReleaseArtwork title={card.title} />
							<div className="release-copy">
								{card.version !== version && (
									<span className="release-earlier">
										Included from {card.version}
									</span>
								)}
								<h3>{card.title}</h3>
								<p>
									{details
										? card.detail
										: card.detail.split(/(?<=[.!?])\s+/)[0]}
								</p>
								{card.detail !== card.detail.split(/(?<=[.!?])\s+/)[0] && (
									<button
										className="release-more"
										type="button"
										aria-expanded={details}
										onClick={() => setDetails(!details)}
									>
										{details ? "Less detail" : "More detail"}
									</button>
								)}
							</div>
						</article>
					</div>
				) : (
					<div className="release-empty">
						<Check size={28} aria-hidden />
						<h3>You’re up to date</h3>
						<p>Your workspace is ready.</p>
					</div>
				)}
				<footer className="release-footer">
					{cards.length > 1 ? (
						<nav className="release-pagination" aria-label="Release highlights">
							<button
								type="button"
								aria-label="Previous highlight"
								disabled={selected === 0}
								onClick={() => select(selected - 1)}
							>
								<ArrowLeft size={15} />
							</button>
							<span aria-live="polite">
								{selected + 1} <span>/ {cards.length}</span>
							</span>
							<button
								type="button"
								aria-label="Next highlight"
								disabled={selected === cards.length - 1}
								onClick={() => select(selected + 1)}
							>
								<ArrowRight size={15} />
							</button>
						</nav>
					) : null}
					<button
						className="release-done"
						type="button"
						onClick={() => onOpenChange(false)}
					>
						Done <Check size={14} aria-hidden />
					</button>
				</footer>
			</DialogContent>
		</Dialog>
	);
}
