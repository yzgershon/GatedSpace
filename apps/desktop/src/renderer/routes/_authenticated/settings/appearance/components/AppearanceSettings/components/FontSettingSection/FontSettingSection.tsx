import { Button } from "@superset/ui/button";
import { Input } from "@superset/ui/input";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import {
	DEFAULT_TERMINAL_FONT_FAMILY,
	DEFAULT_TERMINAL_FONT_SIZE,
} from "renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/Terminal/config";
import {
	DEFAULT_CODE_EDITOR_FONT_FAMILY,
	DEFAULT_CODE_EDITOR_FONT_SIZE,
} from "renderer/screens/main/components/WorkspaceView/components/CodeEditor/constants";
import { FontFamilyCombobox } from "./components/FontFamilyCombobox";
import { FontPreview } from "./components/FontPreview";
import { useSystemFonts } from "./hooks/useSystemFonts";

const VARIANT_CONFIG = {
	editor: {
		title: "Editor font",
		description: "Font used in diff views and file editors",
		defaultFamily: DEFAULT_CODE_EDITOR_FONT_FAMILY,
		defaultSize: DEFAULT_CODE_EDITOR_FONT_SIZE,
		familyKey: "editorFontFamily",
		sizeKey: "editorFontSize",
	},
	terminal: {
		title: "Terminal font & scale",
		description:
			"Font used in terminal panels. The size acts as a terminal-only zoom: turn it down to fit more on screen without shrinking the rest of the app.",
		defaultFamily: DEFAULT_TERMINAL_FONT_FAMILY,
		defaultSize: DEFAULT_TERMINAL_FONT_SIZE,
		familyKey: "terminalFontFamily",
		sizeKey: "terminalFontSize",
	},
} as const;

interface FontSettingSectionProps {
	variant: "editor" | "terminal";
}

export function FontSettingSection({ variant }: FontSettingSectionProps) {
	const config = VARIANT_CONFIG[variant];

	const utils = electronTrpc.useUtils();
	const queryClient = useQueryClient();

	const { data: fontSettings, isLoading } =
		electronTrpc.settings.getFontSettings.useQuery();

	const setFontSettings = electronTrpc.settings.setFontSettings.useMutation({
		onMutate: async (input) => {
			await utils.settings.getFontSettings.cancel();
			const previous = utils.settings.getFontSettings.getData();
			utils.settings.getFontSettings.setData(undefined, (old) => ({
				terminalFontFamily: old?.terminalFontFamily ?? null,
				terminalFontSize: old?.terminalFontSize ?? null,
				editorFontFamily: old?.editorFontFamily ?? null,
				editorFontSize: old?.editorFontSize ?? null,
				...input,
			}));
			return { previous };
		},
		onError: (_err, _vars, context) => {
			if (context?.previous !== undefined) {
				utils.settings.getFontSettings.setData(undefined, context.previous);
			}
		},
		onSettled: () => {
			utils.settings.getFontSettings.invalidate();
			// Terminal panes read font settings through a plain useQuery with its
			// own key (useTerminalAppearance) — invalidate it too so a size change
			// re-scales open terminals immediately instead of after staleTime.
			queryClient.invalidateQueries({
				queryKey: ["electron", "settings", "getFontSettings"],
			});
		},
	});

	const { fonts: systemFonts, isLoading: fontsLoading } = useSystemFonts();

	const [fontSizeDraft, setFontSizeDraft] = useState<string | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: sync draft state when fontSettings changes
	useEffect(() => {
		setFontSizeDraft(null);
	}, [fontSettings]);

	const currentFamily = fontSettings?.[config.familyKey] ?? null;
	const currentSize = fontSettings?.[config.sizeKey] ?? null;

	const handleFontFamilyChange = useCallback(
		(value: string | null) => {
			setFontSettings.mutate({
				[config.familyKey]: value,
			});
		},
		[setFontSettings, config.familyKey],
	);

	const handleFontSizeBlur = useCallback(
		(e: React.FocusEvent<HTMLInputElement>) => {
			const value = Number.parseInt(e.target.value, 10);
			if (!Number.isNaN(value) && value >= 10 && value <= 24) {
				setFontSettings.mutate({ [config.sizeKey]: value });
			}
		},
		[setFontSettings, config.sizeKey],
	);

	// Stepper buttons apply instantly — no blur dance — so tapping −/+ works
	// like a zoom control while open terminals rescale live.
	const stepFontSize = useCallback(
		(delta: number) => {
			const base =
				(fontSizeDraft != null
					? Number.parseInt(fontSizeDraft, 10)
					: undefined) ||
				currentSize ||
				config.defaultSize;
			const next = Math.min(24, Math.max(10, base + delta));
			setFontSizeDraft(null);
			setFontSettings.mutate({ [config.sizeKey]: next });
		},
		[fontSizeDraft, currentSize, config.defaultSize, config.sizeKey, setFontSettings],
	);

	const previewFamily = currentFamily ?? config.defaultFamily;
	const previewSize =
		(fontSizeDraft != null ? Number.parseInt(fontSizeDraft, 10) : undefined) ||
		currentSize ||
		config.defaultSize;

	return (
		<div>
			<h3 className="text-sm font-medium mb-1">{config.title}</h3>
			<p className="text-xs text-muted-foreground mb-3">
				{config.description}
				{variant === "terminal" && (
					<>
						{" "}
						<a
							href="https://www.nerdfonts.com"
							target="_blank"
							rel="noopener noreferrer"
							className="text-primary hover:underline"
						>
							Nerd Fonts
						</a>{" "}
						recommended for shell theme icons.
					</>
				)}
			</p>
			<div className="flex items-center gap-2">
				<FontFamilyCombobox
					value={currentFamily}
					defaultValue={config.defaultFamily}
					onValueChange={handleFontFamilyChange}
					disabled={isLoading}
					variant={variant}
					fonts={systemFonts}
					fontsLoading={fontsLoading}
				/>
				<Button
					variant="outline"
					size="sm"
					className="size-8 shrink-0 px-0 font-mono"
					aria-label={`Decrease ${config.title} size`}
					disabled={
						isLoading || (currentSize ?? config.defaultSize) <= 10
					}
					onClick={() => stepFontSize(-1)}
				>
					−
				</Button>
				<Input
					type="number"
					min={10}
					max={24}
					value={fontSizeDraft ?? String(currentSize ?? config.defaultSize)}
					onChange={(e) => setFontSizeDraft(e.target.value)}
					onBlur={(e) => {
						handleFontSizeBlur(e);
						setFontSizeDraft(null);
					}}
					disabled={isLoading}
					className="w-16 text-center"
					aria-label={`${config.title} size`}
				/>
				<Button
					variant="outline"
					size="sm"
					className="size-8 shrink-0 px-0 font-mono"
					aria-label={`Increase ${config.title} size`}
					disabled={
						isLoading || (currentSize ?? config.defaultSize) >= 24
					}
					onClick={() => stepFontSize(1)}
				>
					+
				</Button>
				{(currentFamily || currentSize) && (
					<Button
						variant="outline"
						size="sm"
						className="shrink-0"
						onClick={() => {
							setFontSettings.mutate({
								[config.familyKey]: null,
								[config.sizeKey]: null,
							});
							setFontSizeDraft(null);
						}}
					>
						Reset
					</Button>
				)}
			</div>
			<div className="mt-3">
				<FontPreview
					fontFamily={previewFamily}
					fontSize={previewSize}
					variant={variant}
					isCustomFont={currentFamily !== null}
				/>
			</div>
		</div>
	);
}
