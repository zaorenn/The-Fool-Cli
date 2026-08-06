/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * User overrides layered on top of the active theme preset.
 *
 * Shared by main and renderer, so this file stays free of DOM access. Values
 * are written to root CSS variables at runtime, which is what makes a change
 * take effect without a reload.
 *
 * A preset does not define one variable per colour — it defines a family: the
 * accent plus its light and dark steps and the rgb triples Arco blends with. An
 * override that moved only the base variable left most of the window on the old
 * colour, so each override is expanded into the whole family here.
 */

export type ThemeColorKey = 'primary' | 'background' | 'surface' | 'text';

export type ThemeColorSpec = {
  /** Theme variable that names this colour; also what the picker seeds from. */
  cssVar: string;
  label: string;
};

export const THEME_COLOR_SPECS: Record<ThemeColorKey, ThemeColorSpec> = {
  primary: { cssVar: '--color-primary', label: 'primary' },
  background: { cssVar: '--color-bg-1', label: 'background' },
  surface: { cssVar: '--color-bg-2', label: 'surface' },
  text: { cssVar: '--color-text-1', label: 'text' },
};

export const THEME_COLOR_KEYS: ThemeColorKey[] = ['primary', 'background', 'surface', 'text'];

export type ThemeOverrides = {
  /** Absent keys keep the preset's own colour. */
  colors: Partial<Record<ThemeColorKey, string>>;
};

export const THEME_OVERRIDES_CONFIG_KEY = 'ui.themeOverrides';

export const defaultThemeOverrides = (): ThemeOverrides => ({ colors: {} });

/**
 * Palettes the user asked to keep, by the name they gave them.
 *
 * Named rather than numbered because they are recalled out loud — "put the sea
 * one back on" only works if the name is the user's own word for it. Stored
 * beside the active overrides rather than inside them: the active colours are a
 * state, these are a library, and saving one must not change what is on screen.
 */
export const THEME_PALETTES_CONFIG_KEY = 'ui.themePalettes';

export type ThemePalettes = Record<string, ThemeOverrides['colors']>;

/** The most palettes kept, oldest dropped first. */
export const MAX_THEME_PALETTES = 24;

/** Trimmed, lower-cased, and short enough to be said: how a name is matched. */
export const normalizePaletteName = (name: string): string =>
  name.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 48);

/**
 * Drops anything that is not a name mapped to valid colours.
 *
 * Same reasoning as {@link sanitizeThemeOverrides}: this comes back from disk,
 * and every value here ends up in a CSS custom property.
 */
export const sanitizeThemePalettes = (value: unknown): ThemePalettes => {
  if (typeof value !== 'object' || value === null) return {};

  const palettes: ThemePalettes = {};
  for (const [rawName, rawColors] of Object.entries(value as Record<string, unknown>)) {
    const name = normalizePaletteName(rawName);
    if (name.length === 0) continue;

    const { colors } = sanitizeThemeOverrides({ colors: rawColors });
    if (Object.keys(colors).length > 0) palettes[name] = colors;
  }

  return palettes;
};

/** Accepts `#rgb`, `#rrggbb`, or `#rrggbbaa`; anything else is rejected. */
export const isValidHexColor = (value: string): boolean => /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value);

/** Drops unknown keys and invalid colours so stored data cannot inject CSS. */
export const sanitizeThemeOverrides = (value: unknown): ThemeOverrides => {
  const fallback = defaultThemeOverrides();
  if (typeof value !== 'object' || value === null) return fallback;

  const record = value as { colors?: unknown };
  const colors: Partial<Record<ThemeColorKey, string>> = {};

  if (typeof record.colors === 'object' && record.colors !== null) {
    const candidate = record.colors as Record<string, unknown>;
    for (const key of THEME_COLOR_KEYS) {
      const raw = candidate[key];
      if (typeof raw === 'string' && isValidHexColor(raw)) colors[key] = raw.toLowerCase();
    }
  }

  return { colors };
};

// ── Colour maths ───────────────────────────────────────────────────────────────

type Channels = { red: number; green: number; blue: number };

const clampChannel = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

/** Parses `#rgb`, `#rrggbb` and `#rrggbbaa`; alpha is dropped. */
export const parseHexColor = (hex: string): Channels | null => {
  if (!isValidHexColor(hex)) return null;
  const body = hex.slice(1);
  const expanded =
    body.length === 3
      ? body
          .split('')
          .map((character) => character + character)
          .join('')
      : body.slice(0, 6);

  return {
    red: Number.parseInt(expanded.slice(0, 2), 16),
    green: Number.parseInt(expanded.slice(2, 4), 16),
    blue: Number.parseInt(expanded.slice(4, 6), 16),
  };
};

const toHex = ({ red, green, blue }: Channels): string =>
  `#${[red, green, blue].map((channel) => clampChannel(channel).toString(16).padStart(2, '0')).join('')}`;

const mix = (from: Channels, to: Channels, amount: number): Channels => ({
  red: from.red + (to.red - from.red) * amount,
  green: from.green + (to.green - from.green) * amount,
  blue: from.blue + (to.blue - from.blue) * amount,
});

const WHITE: Channels = { red: 255, green: 255, blue: 255 };
const BLACK: Channels = { red: 0, green: 0, blue: 0 };

const lighten = (color: Channels, amount: number): Channels => mix(color, WHITE, amount);
const darken = (color: Channels, amount: number): Channels => mix(color, BLACK, amount);

const triple = ({ red, green, blue }: Channels): string =>
  `${clampChannel(red)}, ${clampChannel(green)}, ${clampChannel(blue)}`;

/** True for a colour a preset would treat as a light theme's base. */
export const isLightColor = (hex: string): boolean => {
  const channels = parseHexColor(hex);
  if (!channels) return false;
  // Rec. 601 luma: good enough to decide which way to shade.
  return (channels.red * 299 + channels.green * 587 + channels.blue * 114) / 1000 > 140;
};

// ── Expansion ─────────────────────────────────────────────────────────────────

type Entry = readonly [string, string];

const accentVariables = (color: Channels): Entry[] => {
  const base = toHex(color);
  const light1 = lighten(color, 0.12);
  const light2 = lighten(color, 0.24);
  const light3 = lighten(color, 0.4);
  const dark1 = darken(color, 0.18);

  return [
    ['--color-primary', base],
    ['--primary', base],
    ['--brand', base],
    ['--brand-hover', toHex(light1)],
    ['--color-brand-fill', base],
    ['--aou-6', base],
    ['--aou-7', toHex(light1)],
    ['--color-primary-light-1', toHex(light1)],
    ['--color-primary-light-2', toHex(light2)],
    ['--color-primary-light-3', toHex(light3)],
    ['--color-primary-dark-1', toHex(dark1)],
    // Arco composes hovers and focus rings from these rgb triples.
    ['--primary-rgb', triple(color)],
    ['--primary-1', triple(darken(color, 0.75))],
    ['--primary-2', triple(darken(color, 0.55))],
    ['--primary-3', triple(darken(color, 0.35))],
    ['--primary-4', triple(darken(color, 0.18))],
    ['--primary-5', triple(darken(color, 0.08))],
    ['--primary-6', triple(color)],
    ['--primary-7', triple(light1)],
    ['--primary-8', triple(light2)],
    ['--primary-9', triple(light3)],
  ];
};

const backgroundVariables = (color: Channels): Entry[] => {
  const base = toHex(color);
  const light = isLightColor(base);
  // The shell sits behind the panels: darker on a dark theme, lighter on a light one.
  const shell = light ? lighten(color, 0.35) : darken(color, 0.3);

  return [
    ['--color-bg-1', base],
    ['--bg-1', base],
    ['--color-bg-base', toHex(shell)],
    ['--bg-base', toHex(shell)],
    ['--fill', base],
    ['--color-fill', base],
    ['--aou-1', base],
  ];
};

const surfaceVariables = (color: Channels): Entry[] => {
  const base = toHex(color);
  const light = isLightColor(base);
  const step = (amount: number) => toHex(light ? darken(color, amount) : lighten(color, amount));

  return [
    ['--color-bg-2', base],
    ['--bg-2', base],
    ['--aou-2', base],
    ['--dialog-fill-0', base],
    ['--workspace-btn-bg', base],
    ['--color-guid-agent-bar', base],
    ['--color-bg-3', step(0.06)],
    ['--bg-3', step(0.06)],
    ['--bg-hover', step(0.04)],
    ['--bg-active', step(0.09)],
  ];
};

const textVariables = (color: Channels): Entry[] => {
  const base = toHex(color);
  const light = isLightColor(base);
  // Secondary and disabled text fade towards the background, whichever way that is.
  const fade = (amount: number) => toHex(light ? darken(color, amount) : darken(color, amount));

  return [
    ['--color-text-1', base],
    ['--text-primary', base],
    ['--text-0', base],
    ['--color-text-2', fade(0.2)],
    ['--text-secondary', fade(0.2)],
    ['--color-text-3', fade(0.4)],
    ['--text-disabled', fade(0.5)],
  ];
};

const EXPANDERS: Record<ThemeColorKey, (color: Channels) => Entry[]> = {
  primary: accentVariables,
  background: backgroundVariables,
  surface: surfaceVariables,
  text: textVariables,
};

/**
 * Expands one chosen colour into every variable that has to move with it.
 *
 * Returns an empty list for a colour that fails validation, so a bad stored
 * value can never reach the stylesheet.
 */
export const colorVariables = (key: ThemeColorKey, hex: string): readonly Entry[] => {
  const channels = parseHexColor(hex);
  return channels ? EXPANDERS[key](channels) : [];
};

/** Every variable a key can write, used to clear an override cleanly. */
export const colorVariableNames = (key: ThemeColorKey): readonly string[] =>
  EXPANDERS[key]({ red: 0, green: 0, blue: 0 }).map(([cssVar]) => cssVar);

/**
 * Surfaces a preset paints with a literal colour rather than a variable.
 *
 * `the-fool.css` ends with `html, body, #root { background-color: #0b0d10 }`,
 * which no variable override can reach — so a background choice also needs this
 * rule re-stated with the chosen colour. Marked important because the preset's
 * own rule is: theme CSS is injected through the custom-CSS processor, which
 * stamps `!important` onto every declaration it finds.
 */
export const shellBackgroundCss = (backgroundHex: string): string | null => {
  const channels = parseHexColor(backgroundHex);
  if (!channels) return null;
  const shell = isLightColor(backgroundHex) ? lighten(channels, 0.35) : darken(channels, 0.3);
  return `html, body, #root { background-color: ${toHex(shell)} !important; }`;
};
