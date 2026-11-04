import { createContext, type ReactNode, useContext } from "react";

export const HotkeyEnabledContext = createContext(true);

/** Mounted but hidden views must not handle document-level shortcuts. */
export function HotkeyScope({
	enabled,
	children,
}: {
	enabled: boolean;
	children: ReactNode;
}) {
	const parentEnabled = useContext(HotkeyEnabledContext);
	return (
		<HotkeyEnabledContext.Provider value={parentEnabled && enabled}>
			{children}
		</HotkeyEnabledContext.Provider>
	);
}
