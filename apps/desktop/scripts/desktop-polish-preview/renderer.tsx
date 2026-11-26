import { createRoot } from "react-dom/client";
import {
	OPEN_WHATS_NEW,
	WhatsNew,
} from "../../src/renderer/components/WhatsNew";
import { setVersion } from "./fixture-client";
import "./style.css";

function Preview() {
	const show = (version: string) => {
		setVersion(version);
		setTimeout(() => window.dispatchEvent(new Event(OPEN_WHATS_NEW)), 30);
	};
	return (
		<main className="polish-preview">
			<header>
				<div className="preview-brand">
					GatedSpace <span>DETAILS, REFINED</span>
				</div>
				<p>Actual interface components. Simulated desktop activity.</p>
			</header>
			<section className="preview-grid">
				<div className="preview-card">
					<span className="preview-number">01 / UPDATES</span>
					<h1>A little less interruption.</h1>
					<p>
						A smaller release gallery, visual highlights, and details when you
						want them.
					</p>
					<div className="preview-buttons">
						<button type="button" onClick={() => show("1.18.66")}>
							Preview What’s New
						</button>
						<button
							type="button"
							className="secondary"
							onClick={() => show("1.18.67")}
						>
							Latest release
						</button>
					</div>
				</div>
				<div className="preview-card">
					<span className="preview-number">02 / COMPUTER CONTROL</span>
					<h2>Know when it’s at work.</h2>
					<p>
						A soft aurora at the edges, a marked cursor, and useful controls
						within reach.
					</p>
					<a className="preview-link" href="./overlay.html">
						Open interactive control preview →
					</a>
				</div>
			</section>
			<iframe
				title="Computer control design preview"
				src="./overlay.html"
				className="overlay-preview"
			/>
			<WhatsNew />
		</main>
	);
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<Preview />);
