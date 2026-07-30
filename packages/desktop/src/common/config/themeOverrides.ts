/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * User overrides layered on top of the active theme preset.
 *
 * Shared by main and renderer, so this file stays free of DOM access. Values
 * are written to root CSS variables at runtime, which is what makes a change
 * take effect without a reload.
 */

export type ThemeColorKey = 'primary' | 'background' | 'surface' | 'text';

export type ThemeColorSpec = {
  /** Theme variable the picker writes to. */
  cssVar: string;
  /** Extra variables kept in step so Arco and UnoCSS agree. */
  alsoSet?: readonly string[];
  label: string;
};

export const THEME_COLOR_SPECS: Record<ThemeColorKey, ThemeColorSpec> = {
  primary: { cssVar: '--color-primary', alsoSet: ['--primary'], label: 'primary' },
  background: { cssVar: '--color-bg-1', alsoSet: ['--color-bg-base'], label: 'background' },
  surface: { cssVar: '--color-bg-2', label: 'surface' },
  text: { cssVar: '--color-text-1', label: 'text' },
};

export const THEME_COLOR_KEYS: ThemeColorKey[] = ['primary', 'background', 'surface', 'text'];

/** Corner rounding, in px. 0 gives square corners. */
export const RADIUS_SPEC = { default: 8, min: 0, max: 24, cssVar: '--border-radius-medium' } as const;

/** Variables scaled proportionally so small and large corners stay consistent. */
export const RADIUS_SCALE: readonly { cssVar: string; factor: number }[] = [
  { cssVar: '--border-radius-small', factor: 0.25 },
  { cssVar: '--border-radius-medium', factor: 1 },
  { cssVar: '--border-radius-large', factor: 1.5 },
];

export type ThemeOverrides = {
  /** Absent keys keep the preset's own colour. */
  colors: Partial<Record<ThemeColorKey, string>>;
  radiusPx: number;
};

export const THEME_OVERRIDES_CONFIG_KEY = 'ui.themeOverrides';

export const defaultThemeOverrides = (): ThemeOverrides => ({ colors: {}, radiusPx: RADIUS_SPEC.default });

/** Accepts `#rgb`, `#rrggbb`, or `#rrggbbaa`; anything else is rejected. */
export const isValidHexColor = (value: string): boolean => /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value);

export const clampRadius = (value: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return RADIUS_SPEC.default;
  return Math.min(RADIUS_SPEC.max, Math.max(RADIUS_SPEC.min, Math.round(value)));
};

/** Drops unknown keys and invalid colours so stored data cannot inject CSS. */
export const sanitizeThemeOverrides = (value: unknown): ThemeOverrides => {
  const fallback = defaultThemeOverrides();
  if (typeof value !== 'object' || value === null) return fallback;

  const record = value as { colors?: unknown; radiusPx?: unknown };
  const colors: Partial<Record<ThemeColorKey, string>> = {};

  if (typeof record.colors === 'object' && record.colors !== null) {
    const candidate = record.colors as Record<string, unknown>;
    for (const key of THEME_COLOR_KEYS) {
      const raw = candidate[key];
      if (typeof raw === 'string' && isValidHexColor(raw)) colors[key] = raw.toLowerCase();
    }
  }

  return { colors, radiusPx: clampRadius(record.radiusPx as number) };
};

/** Expands one hex colour into every variable that must move with it. */
export const colorVariables = (key: ThemeColorKey, hex: string): readonly [string, string][] => {
  const spec = THEME_COLOR_SPECS[key];
  return [spec.cssVar, ...(spec.alsoSet ?? [])].map((cssVar) => [cssVar, hex] as [string, string]);
};

/** Expands the radius into the small/medium/large scale. */
export const radiusVariables = (radiusPx: number): readonly [string, string][] =>
  RADIUS_SCALE.map(
    ({ cssVar, factor }) => [cssVar, `${Math.round(clampRadius(radiusPx) * factor)}px`] as [string, string]
  );
