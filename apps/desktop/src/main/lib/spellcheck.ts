import type { Session } from "electron";

/** Use Electron's local spellchecker, retaining configured languages. */
export function enableComposerSpellcheck(session: Session): void {
	session.setSpellCheckerEnabled(true);
	// macOS selects its spelling languages through the operating system.
	if (process.platform === "darwin") return;
	const current = session.getSpellCheckerLanguages();
	const supported = new Set(session.availableSpellCheckerLanguages);
	// An OS locale alone can leave English prompts unchecked. Keep the user's
	// other dictionaries, and ensure English is available for the composers.
	const languages = [...new Set([...current, "en-US"])].filter((language) =>
		supported.has(language),
	);
	if (languages.length && languages.join(",") !== current.join(",")) {
		session.setSpellCheckerLanguages(languages);
	}
}
