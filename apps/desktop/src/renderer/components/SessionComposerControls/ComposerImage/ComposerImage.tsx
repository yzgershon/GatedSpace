import {
	Dialog,
	DialogContent,
	DialogTitle,
	DialogTrigger,
} from "@superset/ui/dialog";
import { X } from "lucide-react";

export function ComposerImage({
	name,
	source,
	onRemove,
}: {
	name: string;
	source: string;
	onRemove?: () => void;
}) {
	return (
		<div className="session-image-tile">
			<Dialog>
				<DialogTrigger asChild>
					<button
						type="button"
						className="session-image-preview"
						aria-label={`Preview ${name}`}
						title={name}
					>
						<img src={source} alt={name} />
						<span>{name}</span>
					</button>
				</DialogTrigger>
				<DialogContent
					className="session-image-lightbox"
					aria-describedby={undefined}
				>
					<DialogTitle className="sr-only">{name}</DialogTitle>
					<img src={source} alt={name} />
				</DialogContent>
			</Dialog>
			{onRemove && (
				<button
					type="button"
					className="session-image-remove"
					aria-label={`Remove ${name}`}
					onClick={onRemove}
				>
					<X size={12} />
				</button>
			)}
		</div>
	);
}
