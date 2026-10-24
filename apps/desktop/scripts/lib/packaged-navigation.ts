/** Match the persisted history that the packaged renderer restores on boot. */
export function packagedRouteReload(path: string): string {
	const history = JSON.stringify({ entries: [path], index: 0 });
	return `localStorage.setItem('router-history', ${JSON.stringify(history)}); setTimeout(() => location.reload(), 50); true`;
}
