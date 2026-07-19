import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
	DEFAULT_TERMINAL_FONT_SIZE,
	getDefaultTerminalAppearance,
	sanitizeTerminalFontFamily,
	type TerminalAppearance,
} from "renderer/lib/terminal/appearance";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { useTerminalTheme } from "renderer/stores/theme";

const fallbackTheme = getDefaultTerminalAppearance().theme;

export function useTerminalAppearance(): TerminalAppearance {
	const terminalTheme = useTerminalTheme();
	const { data: fontSettings } = useQuery({
		queryKey: ["electron", "settings", "getFontSettings"],
		queryFn: () => electronTrpcClient.settings.getFontSettings.query(),
		// Short staleTime + the settings page invalidating this key makes font
		// size act like a live terminal zoom control.
		staleTime: 5_000,
	});

	return useMemo(() => {
		const theme = terminalTheme ?? fallbackTheme;
		const fontFamily = sanitizeTerminalFontFamily(
			fontSettings?.terminalFontFamily,
		);
		const fontSize =
			fontSettings?.terminalFontSize ?? DEFAULT_TERMINAL_FONT_SIZE;

		return {
			theme,
			background: theme.background ?? "#151110",
			fontFamily,
			fontSize,
		};
	}, [terminalTheme, fontSettings]);
}
