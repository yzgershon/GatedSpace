import Link from "next/link";
export default function Home() {
	return (
		<section className="welcome">
			<p className="setup-note">
				Private Sync · Connect from GatedSpace 1.18.24 or newer.
			</p>
			<p className="eyebrow">YOUR WORK, BETWEEN COMPUTERS</p>
			<h1>
				Pick up where
				<br />
				you left off.
			</h1>
			<p className="lede">
				Keep a private checkpoint of a selected GatedSpace session. Continue on
				your other computer, even while this one is off.
			</p>
			<Link href="/device" className="primary">
				Connect a computer <span aria-hidden="true">↗</span>
			</Link>
			<div className="feature-list">
				<article>
					<span>01</span>
					<div>
						<h2>Encrypted before upload</h2>
						<p>
							Your recovery key stays on your devices. This service stores
							encrypted checkpoints.
						</p>
					</div>
				</article>
				<article>
					<span>02</span>
					<div>
						<h2>Continue independently</h2>
						<p>
							Each PC runs its own agent. Tailscale remains available for phone
							access to a running computer.
						</p>
					</div>
				</article>
				<article>
					<span>03</span>
					<div>
						<h2>Your work stays recoverable</h2>
						<p>
							Revision checks prevent an older PC from silently replacing newer
							work.
						</p>
					</div>
				</article>
			</div>
		</section>
	);
}
