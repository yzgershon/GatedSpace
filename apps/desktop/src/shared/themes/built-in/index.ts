import type { Theme } from "../types";
import { draculaTheme } from "./dracula";
import { darkTheme } from "./ember";
import { koiTheme } from "./koi";
import { lightTheme } from "./light";
import { monokaiTheme } from "./monokai";
import { solarizedLightTheme } from "./solarized-light";
/**
 * All built-in themes
 */
export const builtInThemes: Theme[] = [
	darkTheme,
	lightTheme,
	draculaTheme,
	koiTheme,
	monokaiTheme,
	solarizedLightTheme,
];

/**
 * Default theme ID
 */
export const DEFAULT_THEME_ID = "dark";

/**
 * Get a built-in theme by ID
 */
export function getBuiltInTheme(id: string): Theme | undefined {
	return builtInThemes.find((theme) => theme.id === id);
}

// Re-export individual themes
export {
	darkTheme,
	draculaTheme,
	koiTheme,
	lightTheme,
	monokaiTheme,
	solarizedLightTheme,
};
