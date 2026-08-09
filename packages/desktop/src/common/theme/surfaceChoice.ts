/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the user chose, as the smallest thing that could be stored.
 *
 * A material, a colour, and whatever dials they moved afterwards. Nothing
 * derived is kept: the palette, the ink and every shadow are computed from
 * these three on the way to the page, so a stored choice cannot go stale
 * against a later version of the recipe — and so the whole of somebody's
 * appearance fits in a sentence they could say out loud.
 */

import {
  DEFAULT_ACCENT,
  DEFAULT_SURFACE_STYLE,
  SURFACE_STYLES,
  derivePalette,
  isSurfaceStyleId,
  sanitizeAccent,
  sanitizeMaterialTokens,
  surfaceVariables,
  type MaterialTokens,
  type SurfaceStyleId,
} from '@/common/theme/surfaceStyle';

export type SurfaceStyleChoice = {
  style: SurfaceStyleId;
  /** The one colour everything else is derived from. */
  accent: string;
  /**
   * Only what was moved away from the material's own defaults.
   *
   * Stored as a partial so choosing a material later brings its new defaults
   * with it: somebody who nudged the corners once should not be pinned to every
   * other number that material happened to have the day they did it.
   */
  tokens?: Partial<MaterialTokens>;
};

export const defaultSurfaceChoice = (): SurfaceStyleChoice => ({
  style: DEFAULT_SURFACE_STYLE,
  accent: DEFAULT_ACCENT,
});

/**
 * Repairs whatever was stored.
 *
 * This value arrives from a config file, from another window, and from a model
 * told to make the interface calmer. Anything unrecognised becomes the
 * application's own answer rather than something the browser will try to read.
 */
export const sanitizeSurfaceChoice = (value: unknown): SurfaceStyleChoice => {
  if (typeof value !== 'object' || value === null) return defaultSurfaceChoice();

  const record = value as Record<string, unknown>;
  const style = isSurfaceStyleId(record.style) ? record.style : DEFAULT_SURFACE_STYLE;
  const accent = sanitizeAccent(record.accent);

  if (typeof record.tokens !== 'object' || record.tokens === null) return { style, accent };

  // Sanitised against the material being worn, then reduced back to only what
  // actually differs — so the stored shape stays a list of deliberate changes.
  const base = SURFACE_STYLES[style].tokens;
  const full = sanitizeMaterialTokens(record.tokens, base);
  const moved: Partial<MaterialTokens> = {};
  for (const key of Object.keys(base) as (keyof MaterialTokens)[]) {
    if (full[key] !== base[key]) moved[key] = full[key];
  }

  return Object.keys(moved).length > 0 ? { style, accent, tokens: moved } : { style, accent };
};

/** The numbers this choice actually resolves to. */
export const resolveTokens = (choice: SurfaceStyleChoice): MaterialTokens =>
  sanitizeMaterialTokens(choice.tokens ?? {}, SURFACE_STYLES[choice.style].tokens);

/**
 * Everything a page needs, from the three things that were stored.
 *
 * Returned as pairs rather than written here so this stays pure: the caller
 * decides which document it belongs to, which is what lets the settings panel
 * preview a choice without wearing it.
 */
export const surfaceChoiceVariables = (
  choice: SurfaceStyleChoice,
  prefersDark: boolean
): readonly (readonly [string, string])[] =>
  surfaceVariables(
    choice.style,
    resolveTokens(choice),
    derivePalette(choice.accent, choice.style, prefersDark, resolveTokens(choice).tint)
  );
