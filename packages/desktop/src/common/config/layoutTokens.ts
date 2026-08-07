/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The dials behind the look, as numbers rather than as choices.
 *
 * A layout picks a composition — a column or a dial, settings beside or behind.
 * These are the other half: how sharp the corners are, how much air there is,
 * how quickly things move. They are what someone means by "make the corners
 * rounder" or "calm it down", and none of it is a decision a picker with four
 * options can express.
 *
 * Numbers on purpose, and continuous ones. A person turning a slider until the
 * corners look right is doing design; a person choosing between "rounded" and
 * "square" is choosing between two of somebody else's opinions. The whole point
 * of this is that it belongs to the user, so the range is wide and every value
 * in it has to work.
 *
 * Everything here becomes a CSS custom property, which is why the sanitiser is
 * strict about types and ranges: these end up in a stylesheet, and a value that
 * arrived from a config file or a language model must not be able to write
 * anything but a number into one.
 */

/** One knob, and what it is allowed to be. */
export type TokenSpec = {
  /** What it is called in the interface. */
  label: string;
  min: number;
  max: number;
  /** How fine the control is. */
  step: number;
  /** What the app has always looked like, so leaving it alone changes nothing. */
  fallback: number;
  /** The CSS unit written after the number, if any. */
  unit: 'px' | 'ms' | '';
};

export type LayoutTokens = {
  /**
   * How sharp the corners are, in pixels.
   *
   * Zero is a square corner and it is a real choice rather than a broken one:
   * plenty of people want an interface with no rounding at all, and the app
   * having an opinion about that is the thing this replaces.
   */
  radius: number;
  /** How much air there is, as a multiplier on the app's own spacing. */
  spacing: number;
  /** How big the text is, as a multiplier. */
  textScale: number;
  /** How long a transition takes, in milliseconds. */
  motionMs: number;
  /** How far the accent colour reaches, 0 to 1. */
  accent: number;
  /** How strongly surfaces are separated from the ground, 0 to 1. */
  contrast: number;
};

export type LayoutTokenKey = keyof LayoutTokens;

/**
 * The knobs, in the order a panel should show them.
 *
 * Ordered by how often somebody reaches for one: corners first, because that is
 * the single most-asked-for change to any interface, and contrast last because
 * it is the one people set once.
 */
export const TOKEN_SPECS: Record<LayoutTokenKey, TokenSpec> = {
  radius: { label: 'radius', min: 0, max: 28, step: 1, fallback: 12, unit: 'px' },
  spacing: { label: 'spacing', min: 0.7, max: 1.6, step: 0.05, fallback: 1, unit: '' },
  textScale: { label: 'textScale', min: 0.85, max: 1.3, step: 0.05, fallback: 1, unit: '' },
  motionMs: { label: 'motionMs', min: 0, max: 600, step: 20, fallback: 220, unit: 'ms' },
  accent: { label: 'accent', min: 0, max: 1, step: 0.05, fallback: 1, unit: '' },
  contrast: { label: 'contrast', min: 0, max: 1, step: 0.05, fallback: 0.5, unit: '' },
};

export const LAYOUT_TOKEN_KEYS = Object.keys(TOKEN_SPECS) as LayoutTokenKey[];

/** What the app has always looked like. Leaving every knob alone changes nothing. */
export const defaultLayoutTokens = (): LayoutTokens =>
  Object.fromEntries(LAYOUT_TOKEN_KEYS.map((key) => [key, TOKEN_SPECS[key].fallback])) as LayoutTokens;

/** Rounds to the control's own step, so a stored value matches what a slider shows. */
const snap = (value: number, spec: TokenSpec): number => {
  const clamped = Math.min(spec.max, Math.max(spec.min, value));
  const stepped = Math.round(clamped / spec.step) * spec.step;
  // Two places is enough for every step here and keeps 0.30000000000000004 out
  // of a stylesheet.
  return Math.round(stepped * 100) / 100;
};

/**
 * Repairs whatever was stored into numbers a stylesheet can take.
 *
 * Every value here is written into a CSS custom property, and it arrives from a
 * config store, an imported file and a language model. A string that is not a
 * number, an infinity, a value out of range: each becomes the app's own default
 * rather than something the browser will try to parse.
 */
export const sanitizeLayoutTokens = (value: unknown): LayoutTokens => {
  const tokens = defaultLayoutTokens();
  if (typeof value !== 'object' || value === null) return tokens;

  const record = value as Record<string, unknown>;
  for (const key of LAYOUT_TOKEN_KEYS) {
    const raw = record[key];
    const asNumber = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
    if (Number.isFinite(asNumber)) tokens[key] = snap(asNumber, TOKEN_SPECS[key]);
  }

  return tokens;
};

/** True when nothing has been moved, so nothing needs writing to the page. */
export const tokensAreDefault = (tokens: LayoutTokens): boolean =>
  LAYOUT_TOKEN_KEYS.every((key) => tokens[key] === TOKEN_SPECS[key].fallback);

/**
 * The custom properties the app reads.
 *
 * Named rather than derived so a component can use one without knowing this
 * module exists: `border-radius: var(--fool-radius)` is a line anybody can write
 * and it does the right thing whatever the user has chosen.
 */
export const tokenVariables = (tokens: LayoutTokens): readonly (readonly [string, string])[] => {
  const radius = `${tokens.radius}px`;

  return [
    ['--fool-radius', radius],
    // A family rather than one value: a chip and a panel should not carry the
    // same corner, and a single variable makes every rounded thing identical.
    ['--fool-radius-sm', `${Math.round(tokens.radius * 0.5)}px`],
    ['--fool-radius-lg', `${Math.round(tokens.radius * 1.5)}px`],
    ['--fool-radius-pill', tokens.radius === 0 ? '0px' : '999px'],
    ['--fool-spacing', String(tokens.spacing)],
    ['--fool-text-scale', String(tokens.textScale)],
    ['--fool-motion', `${tokens.motionMs}ms`],
    ['--fool-motion-fast', `${Math.round(tokens.motionMs * 0.6)}ms`],
    // Zero means "do not move", which is also what the system's reduced-motion
    // setting means — so the two agree rather than fighting.
    ['--fool-motion-ease', tokens.motionMs === 0 ? 'linear' : 'cubic-bezier(0.22, 0.61, 0.36, 1)'],
    ['--fool-accent-strength', String(tokens.accent)],
    ['--fool-contrast', String(tokens.contrast)],
  ];
};

/**
 * The stylesheet that makes the corner setting reach things already written.
 *
 * Most of the app was built before these existed and says `rounded-12px` in a
 * utility class. A variable nothing reads would be a slider that does nothing,
 * which is worse than no slider — so the radius is also asserted over the shapes
 * the app actually uses.
 *
 * Deliberately narrow. It moves corners and transition durations and touches
 * nothing else: a stylesheet that reached further would be a theme, and the
 * user already has one of those.
 */
export const tokenStylesheet = (tokens: LayoutTokens): string => {
  const rules: string[] = [];

  if (tokens.radius !== TOKEN_SPECS.radius.fallback) {
    rules.push(
      // Arco's own surfaces, which is most of what is on screen.
      `.arco-card, .arco-modal, .arco-drawer, .arco-select-view, .arco-input-wrapper,
       .arco-textarea, .arco-btn, .arco-tag, .arco-dropdown-menu, .arco-popover-content,
       .arco-message, .arco-notification, .arco-collapse-item-content-box {
         border-radius: ${tokens.radius}px !important;
       }`,
      // A pill button stays a pill unless corners were taken to zero, where the
      // user has plainly asked for square and a lone rounded button would look
      // like something the setting failed to reach.
      `.arco-btn-shape-round { border-radius: ${tokens.radius === 0 ? '0' : '999'}px !important; }`
    );
  }

  if (tokens.motionMs !== TOKEN_SPECS.motionMs.fallback) {
    rules.push(
      `.arco-modal, .arco-drawer, .arco-btn, .arco-select-view {
         transition-duration: ${tokens.motionMs}ms !important;
       }`
    );
  }

  if (tokens.textScale !== TOKEN_SPECS.textScale.fallback) {
    // On the root font size rather than on every element: everything sized in
    // rem follows, and anything sized in px is left exactly where it was, which
    // is the honest limit of what one number can do here.
    rules.push(`:root { font-size: ${Math.round(16 * tokens.textScale)}px; }`);
  }

  return rules.join('\n');
};
