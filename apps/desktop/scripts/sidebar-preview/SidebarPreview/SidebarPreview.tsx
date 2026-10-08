import { ArrowUpRight, Check, Moon, RotateCcw, Sun } from "lucide-react";
import { useState } from "react";
import { type Direction, directions } from "../data";
import { MessageQueuePreview } from "../MessageQueuePreview/MessageQueuePreview";
import { NavigationPreview } from "../NavigationPreview/NavigationPreview";

export function SidebarPreview() {
	const [direction, setDirection] = useState<Direction>("focus");
	const [area, setArea] = useState("sidebar");
	const [title, setTitle] = useState("GatedSpace Edits");
	const [reset, setReset] = useState(0);
	const [light, setLight] = useState(false);
	const [chosen, setChosen] = useState<Direction | null>(null);
	const [openNotice, setOpenNotice] = useState("");
	return (
		<main className={`design-lab ${light ? "light" : ""}`}>
			<header className="lab-header">
				<div>
					<span className="preview-label">GatedSpace / Design preview</span>
					<h1>A clearer place to pick up.</h1>
					<p>Three sidebar directions. One editable message queue.</p>
				</div>
				<div className="lab-tools">
					<button
						type="button"
						className="icon-button"
						aria-label="Toggle light theme"
						onClick={() => setLight(!light)}
					>
						{light ? <Moon /> : <Sun />}
					</button>
					<button
						type="button"
						className="icon-button"
						aria-label="Reset preview"
						onClick={() => {
							setReset((v) => v + 1);
							setOpenNotice("");
						}}
					>
						<RotateCcw />
					</button>
					<a
						className="icon-button"
						href={window.location.href}
						target="_blank"
						rel="noreferrer"
						aria-label="Open full preview"
						title="Open full preview"
					>
						<ArrowUpRight />
					</a>
				</div>
			</header>
			<nav className="direction-picker" aria-label="Design direction">
				{Object.entries(directions).map(([id, directionInfo], index) => (
					<button
						type="button"
						key={id}
						aria-pressed={direction === id}
						onClick={() => {
							setDirection(id as Direction);
							setOpenNotice("");
						}}
					>
						<span className="option-letter">
							{String.fromCharCode(65 + index)}
						</span>
						<span>{directionInfo.name}</span>
						{direction === id && <Check />}
					</button>
				))}
			</nav>
			<div className="direction-description">
				<p>{directions[direction].description}</p>
				<button
					type="button"
					className="choose-direction"
					onClick={() => setChosen(direction)}
				>
					{chosen === direction ? (
						<>
							<Check />
							Selected
						</>
					) : (
						"Shortlist this design"
					)}
				</button>
			</div>
			<nav className="preview-area" aria-label="Preview area">
				<button
					type="button"
					aria-pressed={area === "sidebar"}
					onClick={() => setArea("sidebar")}
				>
					Sidebar
				</button>
				<button
					type="button"
					aria-pressed={area === "composer"}
					onClick={() => setArea("composer")}
				>
					Message queue
				</button>
			</nav>
			<div className={`preview-stage area-${area}`} key={reset}>
				<NavigationPreview
					direction={direction}
					onOpen={(name) => {
						setTitle(name);
						setOpenNotice(`Opened ${name} in the preview.`);
					}}
				/>
				<MessageQueuePreview title={title} />
			</div>
			<div className="lab-bottom">
				<output>
					{openNotice ||
						(chosen
							? `${directions[chosen].name} shortlisted locally. Share your choice in the question card.`
							: "Try search, filters, pinning, workspace branches, and the message queue.")}
				</output>
				<span>Sample sessions only</span>
			</div>
		</main>
	);
}
