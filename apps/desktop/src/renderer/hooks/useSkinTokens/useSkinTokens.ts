import { useV2UserPreferences } from "renderer/hooks/useV2UserPreferences";
import { resolveSkinTokens, type SkinTokens } from "./skin-tokens";

/**
 * The active appearance, as tokens.
 *
 * Every consumer goes through this rather than reading `appearanceSkin`
 * directly, so no component ever contains the string "liquid-glass". See
 * `skin-tokens.ts` for why.
 */
export function useSkinTokens(): SkinTokens {
	const { preferences } = useV2UserPreferences();
	return resolveSkinTokens(preferences.appearanceSkin);
}
