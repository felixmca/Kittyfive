/**
 * Where the fixed chrome sits, for pages that put their own controls near it.
 * The Kitty home button is 44 px, top-left; the menu button is 44 px, top-right.
 */

/** The top edge of the chrome row (safe-area aware). */
export const CHROME_TOP = "max(12px, env(safe-area-inset-top))";
/** The left edge of the home button. */
export const CHROME_LEFT = "max(12px, env(safe-area-inset-left))";
/** The first x that is clear of the home button (its left edge + 44 px + an 8 px gap). */
export const CLEAR_OF_HOME = "calc(max(12px, env(safe-area-inset-left)) + 52px)";
/** The first y below the chrome row (its top + 44 px + a 12 px gap). */
export const BELOW_CHROME = "calc(max(12px, env(safe-area-inset-top)) + 56px)";
