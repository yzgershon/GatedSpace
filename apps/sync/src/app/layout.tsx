import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./style.css";
export const metadata: Metadata = {
	title: "GatedSpace Sync",
	description: "Private continuity between your computers.",
	robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<body>
				<header>
					<a href="/" className="brand">
						<span aria-hidden="true">◇</span> GatedSpace <small>Sync</small>
					</a>
					<span className="private-label">PRIVATE SERVICE</span>
				</header>
				<main>{children}</main>
				<footer>
					Conversations stay yours. Each computer uses its own AI account.
				</footer>
			</body>
		</html>
	);
}
