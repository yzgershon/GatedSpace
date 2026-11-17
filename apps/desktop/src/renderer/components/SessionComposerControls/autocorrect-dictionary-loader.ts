let loaded: typeof import("./autocorrect-dictionary") | undefined;
let loading: Promise<void> | undefined;

/** One lazy dictionary per renderer, shared by every pane. Never call a provider. */
export function warmAutocorrectDictionary(): Promise<void> {
	if (!loading)
		loading = import("./autocorrect-dictionary")
			.then((module) => {
				loaded = module;
			})
			.catch(() => {
				// Common corrections and native right-click suggestions remain available.
				loading = undefined;
			});
	return loading;
}

export function spellingSuggestions(word: string): string[] {
	return loaded?.spellingSuggestions(word) ?? [];
}
