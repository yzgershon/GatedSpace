/**
 * A deliberately empty panel, held open for whatever earns the space.
 *
 * It says so rather than showing nothing: a blank pane reads as something that
 * failed to load, and the difference between "broken" and "not built yet" is
 * worth two lines of text.
 */
export function SidebarTestingPanel() {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
			<p className="text-sm text-muted-foreground">Testing</p>
			<p className="text-xs text-muted-foreground/60">
				Nothing here yet — this panel is reserved.
			</p>
		</div>
	);
}
