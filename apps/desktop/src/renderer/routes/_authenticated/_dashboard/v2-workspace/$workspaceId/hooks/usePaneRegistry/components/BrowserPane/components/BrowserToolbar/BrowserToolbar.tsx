import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	TbArrowLeft,
	TbArrowRight,
	TbLoader2,
	TbRefresh,
} from "react-icons/tb";
import { BrowserTabIcon } from "../../BrowserTabIcon";
import { UrlSuggestions } from "./components/UrlSuggestions";
import { useUrlAutocomplete } from "./hooks/useUrlAutocomplete";

function displayUrl(url: string): string {
	if (url === "about:blank") return "";
	return url.endsWith("/") ? url.slice(0, -1) : url;
}

interface BrowserToolbarProps {
	currentUrl: string;
	pageTitle: string;
	faviconUrl?: string | null;
	isLoading: boolean;
	canGoBack: boolean;
	canGoForward: boolean;
	onGoBack: () => void;
	onGoForward: () => void;
	onReload: () => void;
	onNavigate: (url: string) => void;
}

export function BrowserToolbar({
	currentUrl,
	pageTitle,
	faviconUrl,
	isLoading,
	canGoBack,
	canGoForward,
	onGoBack,
	onGoForward,
	onReload,
	onNavigate,
}: BrowserToolbarProps) {
	const [isEditing, setIsEditing] = useState(false);
	const [urlInputValue, setUrlInputValue] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	const url = displayUrl(currentUrl);
	const isBlank = !url;

	const autocomplete = useUrlAutocomplete({
		onSelect: (selectedUrl) => {
			onNavigate(selectedUrl);
			setIsEditing(false);
		},
	});

	useEffect(() => {
		if (isEditing) {
			inputRef.current?.focus();
			inputRef.current?.select();
		}
	}, [isEditing]);

	const enterEditMode = useCallback(() => {
		setUrlInputValue(url);
		setIsEditing(true);
		autocomplete.open();
		autocomplete.updateQuery(url);
	}, [url, autocomplete]);

	const exitEditMode = useCallback(() => {
		setIsEditing(false);
		autocomplete.close();
	}, [autocomplete]);

	const handleSubmit = useCallback(
		(e: React.FormEvent) => {
			e.preventDefault();
			const trimmed = urlInputValue.trim();
			if (trimmed) {
				onNavigate(trimmed);
				setIsEditing(false);
				autocomplete.close();
			}
		},
		[urlInputValue, onNavigate, autocomplete],
	);

	const handleInputChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const value = e.target.value;
			setUrlInputValue(value);
			autocomplete.updateQuery(value);
			if (!autocomplete.isOpen) {
				autocomplete.open();
			}
		},
		[autocomplete],
	);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			const handled = autocomplete.handleKeyDown(e);
			if (handled) return;
			if (e.key === "Escape") {
				setIsEditing(false);
			}
		},
		[autocomplete],
	);

	return (
		<div className="gs-browser-toolbar flex h-full min-w-0 flex-1 items-center gap-2 px-2">
			<div className="flex shrink-0 items-center gap-0.5">
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							aria-label="Go back"
							onClick={onGoBack}
							disabled={!canGoBack}
							className="gs-browser-nav-button"
						>
							<TbArrowLeft className="size-4" />
						</button>
					</TooltipTrigger>
					<TooltipContent side="bottom" showArrow={false}>
						Go Back
					</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							aria-label="Go forward"
							onClick={onGoForward}
							disabled={!canGoForward}
							className="gs-browser-nav-button"
						>
							<TbArrowRight className="size-4" />
						</button>
					</TooltipTrigger>
					<TooltipContent side="bottom" showArrow={false}>
						Go Forward
					</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							aria-label="Reload page"
							onClick={onReload}
							className="gs-browser-nav-button"
						>
							{isLoading ? (
								<TbLoader2 className="size-4 animate-spin" />
							) : (
								<TbRefresh className="size-4" />
							)}
						</button>
					</TooltipTrigger>
					<TooltipContent side="bottom" showArrow={false}>
						{isLoading ? "Loading..." : "Reload"}
					</TooltipContent>
				</Tooltip>
			</div>
			<div className="gs-browser-address relative flex min-w-0 flex-1 items-center">
				<span className="gs-browser-address-icon">
					{isBlank || isEditing ? (
						<Search className="size-3.5" />
					) : (
						<BrowserTabIcon data={{ url: currentUrl, pageTitle, faviconUrl }} />
					)}
				</span>
				{isEditing ? (
					<form
						onSubmit={handleSubmit}
						className="flex w-full min-w-0 items-center"
					>
						<input
							ref={inputRef}
							type="text"
							value={urlInputValue}
							onChange={handleInputChange}
							onBlur={exitEditMode}
							onKeyDown={handleKeyDown}
							aria-label="Address or search"
							placeholder="Search Google or type a URL"
							className="h-8 w-full min-w-0 bg-transparent pr-3 text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
							spellCheck={false}
							autoComplete="off"
						/>
					</form>
				) : (
					<button
						type="button"
						aria-label="Edit address or search"
						title={isBlank ? undefined : url}
						onClick={enterEditMode}
						className="group flex h-8 w-full min-w-0 items-center pr-3 text-left text-xs"
					>
						{isBlank ? (
							<span className="min-w-0 truncate text-muted-foreground/40">
								Search Google or type a URL
							</span>
						) : (
							<span className="min-w-0 shrink truncate text-muted-foreground transition-colors group-hover:text-foreground">
								{url}
							</span>
						)}
					</button>
				)}
				{isEditing && autocomplete.isOpen && (
					<UrlSuggestions
						suggestions={autocomplete.suggestions}
						highlightedIndex={autocomplete.highlightedIndex}
						onSelect={autocomplete.selectSuggestion}
					/>
				)}
			</div>
		</div>
	);
}
