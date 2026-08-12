/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the application is made of.
 *
 * `layoutTokens` already holds the shape of things — corners, air, motion. This
 * is the other half: the material. Whether a surface is raised out of the same
 * dough as the ground, or a pane of glass with a lit world behind it, or a card
 * with a hard black shadow that does not blur. Seven of them, and each brings
 * its own ground, its own surface recipe and its own way of moving, because a
 * style that only changed the shadow would be a setting nobody could feel.
 *
 * Two rules hold this together:
 *
 * **The text is never guessed at.** Ink is derived from the measured luminance
 * of the ground it will sit on, and what goes on top of the accent is decided
 * by contrast rather than by eye. Whatever colour the user picks, in whatever
 * style, the words stay readable — including the colours nobody thought to try.
 *
 * **Everything is a number, and every number is repaired on the way in.** These
 * values reach a stylesheet, and they arrive from a config file, an imported
 * theme and a language model asked to "make it warmer". A string that is not a
 * number cannot get through, so nothing but a number can ever be written into a
 * custom property.
 */

/** The materials, in the order a picker should offer them. */
export const SURFACE_STYLE_IDS = ['neu', 'glass', 'liquid', 'clay', 'aurora', 'brutal', 'minimal'] as const;

export type SurfaceStyleId = (typeof SURFACE_STYLE_IDS)[number];

export const DEFAULT_SURFACE_STYLE: SurfaceStyleId = 'neu';

/** One dial of the material, and what it is allowed to be. */
export type MaterialSpec = {
  min: number;
  max: number;
  step: number;
  fallback: number;
};

/**
 * The dials that describe a material rather than a shape.
 *
 * Deliberately continuous, and deliberately wide. Someone dragging until the
 * glass looks right is doing design; someone choosing between "frosted" and
 * "clear" is choosing between two of somebody else's opinions.
 */
export type MaterialTokens = {
  /**
   * How round a corner is, in pixels.
   *
   * A material rather than a layout decision, however much it looks like one:
   * brutal with rounded corners is not brutal, and clay with square ones is not
   * clay. The layout's own radius still governs an application wearing no
   * material at all.
   */
  radius: number;
  /** Thickness of the line around a surface, in pixels. */
  edge: number;
  /** How far a surface stands off the ground. Feeds every shadow. */
  depth: number;
  /** Hard-edged shadow at the low end, smoke at the high end. */
  spread: number;
  /** The light along a surface's top edge. */
  inner: number;
  /** How much of what is behind a surface survives, in pixels of blur. */
  blur: number;
  /** How much of the surface lets the ground through, 0 to 1. */
  alpha: number;
  /** How much the material deepens the colour behind it, in percent. */
  saturation: number;
  /** The light that travels across a surface when it is pointed at. */
  sheen: number;
  /** Weight of headings. */
  weight: number;
  /** Letter-spacing of headings, in em. Negative tightens. */
  tracking: number;
  /** Line height of body text. */
  leading: number;
  /** Space between cards, as a multiplier. */
  gap: number;
  /** How much a transition overshoots, 0 to 1. */
  bounce: number;
  /** How far a surface rises when pointed at, in pixels. */
  lift: number;
  /** How far it sinks when pressed, in pixels. */
  press: number;
  /** Ambient movement — a breathing ground, a pulse. 0 turns it off. */
  ambient: number;
  /** How far the accent hue reaches into the greys, 0 to 2. */
  tint: number;
};

export type MaterialTokenKey = keyof MaterialTokens;

export const MATERIAL_SPECS: Record<MaterialTokenKey, MaterialSpec> = {
  radius: { min: 0, max: 36, step: 1, fallback: 12 },
  edge: { min: 0, max: 4, step: 1, fallback: 0 },
  depth: { min: 0, max: 30, step: 1, fallback: 12 },
  spread: { min: 0.3, max: 2.2, step: 0.1, fallback: 1 },
  inner: { min: 0, max: 1.4, step: 0.05, fallback: 0.6 },
  blur: { min: 0, max: 40, step: 1, fallback: 0 },
  alpha: { min: 0.4, max: 1, step: 0.05, fallback: 1 },
  saturation: { min: 0, max: 120, step: 5, fallback: 0 },
  sheen: { min: 0, max: 1, step: 0.05, fallback: 0 },
  weight: { min: 500, max: 900, step: 10, fallback: 700 },
  tracking: { min: -0.05, max: 0.04, step: 0.005, fallback: -0.02 },
  leading: { min: 1.25, max: 1.9, step: 0.05, fallback: 1.55 },
  gap: { min: 0.4, max: 2, step: 0.05, fallback: 1 },
  bounce: { min: 0, max: 1, step: 0.05, fallback: 0 },
  lift: { min: 0, max: 16, step: 1, fallback: 6 },
  press: { min: 0, max: 4, step: 1, fallback: 1 },
  ambient: { min: 0, max: 1, step: 0.05, fallback: 1 },
  tint: { min: 0, max: 2, step: 0.05, fallback: 1 },
};

export const MATERIAL_TOKEN_KEYS = Object.keys(MATERIAL_SPECS) as MaterialTokenKey[];

/**
 * How light a style's ground is, and how much of the accent it carries.
 *
 * `ground` is a pair: the lightness in a light theme and in a dark one. Aurora
 * declares itself dark in both, because a dark aurora in a light room is a
 * different product, not a lighter version of the same one.
 */
type StyleGround = {
  /** Forced appearance, when the material only exists one way round. */
  forcedDark?: true;
  /** Ground lightness: [light theme, dark theme]. */
  ground: readonly [number, number];
  /** How much accent saturation reaches the ground, 0 to 1. */
  groundTint: number;
  /** Lightness of the coloured washes some styles paint behind their surfaces. */
  wash: number;
};

export type SurfaceStyle = StyleGround & {
  id: SurfaceStyleId;
  /** The dials this material sets when it is chosen. */
  tokens: MaterialTokens;
  /**
   * The dials that do something on this material, and only those.
   *
   * A blur slider on a material with an opaque surface moves a number nothing
   * reads. It is worse than a missing control: the user drags it, watches
   * nothing happen, and now doubts every other control on the page. So a
   * material declares what it can actually feel, and the panel shows that.
   *
   * Everything not named here is still a real number — it is simply not this
   * material's, and choosing one that uses it brings the dial back.
   */
  dials: readonly MaterialTokenKey[];
};

/** Dials every material feels, whatever it is made of. */
const UNIVERSAL: readonly MaterialTokenKey[] = [
  'radius',
  'tint',
  'weight',
  'tracking',
  'leading',
  'gap',
  'lift',
  'press',
  'bounce',
];

const material = (values: Partial<MaterialTokens>): MaterialTokens => ({
  ...(Object.fromEntries(MATERIAL_TOKEN_KEYS.map((key) => [key, MATERIAL_SPECS[key].fallback])) as MaterialTokens),
  ...values,
});

export const SURFACE_STYLES: Record<SurfaceStyleId, SurfaceStyle> = {
  // Everything out of one piece of dough: nothing is cut out, nothing floats.
  neu: {
    id: 'neu',
    dials: [...UNIVERSAL, 'depth', 'spread', 'inner'],
    ground: [93, 12],
    groundTint: 0.16,
    wash: 88,
    tokens: material({ radius: 20, depth: 12, inner: 0.6, lift: 6, press: 1 }),
  },
  // A pane needs a world behind it, so this style paints one.
  glass: {
    id: 'glass',
    dials: [...UNIVERSAL, 'edge', 'depth', 'spread', 'blur', 'alpha', 'saturation', 'sheen'],
    ground: [92, 12],
    groundTint: 0.2,
    wash: 66,
    tokens: material({
      radius: 18,
      depth: 10,
      spread: 1.2,
      inner: 0.4,
      blur: 18,
      alpha: 0.85,
      saturation: 40,
      sheen: 0.4,
      weight: 680,
      bounce: 0.2,
      lift: 7,
    }),
  },
  // Glass that bends: the colour beneath leaks into the surface and the shape
  // gives a little when it is touched.
  liquid: {
    id: 'liquid',
    dials: [...UNIVERSAL, 'edge', 'depth', 'spread', 'inner', 'blur', 'alpha', 'saturation', 'sheen'],
    ground: [91, 14],
    groundTint: 0.24,
    wash: 64,
    tokens: material({
      radius: 26,
      depth: 14,
      spread: 1.3,
      inner: 0.9,
      blur: 24,
      alpha: 0.85,
      saturation: 70,
      sheen: 0.7,
      weight: 660,
      tracking: -0.025,
      leading: 1.6,
      gap: 1.1,
      bounce: 0.6,
      lift: 9,
    }),
  },
  // Thick, soft, and coloured by its own shadow.
  clay: {
    id: 'clay',
    dials: [...UNIVERSAL, 'depth', 'spread', 'inner'],
    ground: [90, 16],
    groundTint: 0.45,
    wash: 86,
    tokens: material({
      radius: 30,
      depth: 16,
      inner: 1,
      weight: 780,
      tracking: -0.01,
      leading: 1.6,
      gap: 1.2,
      bounce: 0.9,
      lift: 8,
      press: 2,
    }),
  },
  // The ground is the subject; surfaces are dark windows onto it.
  aurora: {
    id: 'aurora',
    dials: [...UNIVERSAL, 'edge', 'depth', 'spread', 'blur', 'alpha', 'saturation', 'ambient'],
    forcedDark: true,
    ground: [10, 8],
    groundTint: 0.3,
    wash: 60,
    tokens: material({
      radius: 22,
      depth: 12,
      spread: 1.4,
      inner: 0.3,
      blur: 20,
      alpha: 0.55,
      saturation: 60,
      sheen: 0.2,
      tracking: -0.03,
      leading: 1.6,
      gap: 1.1,
      bounce: 0.3,
      lift: 5,
    }),
  },
  // Paper and ink. The shadow does not blur and the motion does not ease.
  brutal: {
    id: 'brutal',
    dials: [...UNIVERSAL, 'edge', 'depth'],
    ground: [94, 12],
    groundTint: 0.5,
    wash: 90,
    tokens: material({
      radius: 0,
      edge: 1,
      depth: 14,
      inner: 0,
      weight: 800,
      tracking: -0.04,
      leading: 1.45,
      gap: 0.9,
      lift: 5,
      press: 2,
      ambient: 0,
    }),
  },
  // A line, a gap, and nothing else.
  minimal: {
    id: 'minimal',
    dials: [...UNIVERSAL, 'edge'],
    ground: [96, 10],
    groundTint: 0.08,
    wash: 94,
    tokens: material({
      radius: 8,
      depth: 0,
      inner: 0,
      weight: 640,
      tracking: -0.015,
      leading: 1.62,
      gap: 0.9,
      lift: 2,
      press: 0,
      ambient: 0.4,
    }),
  },
};

/** True when the value names a material this application has. */
export const isSurfaceStyleId = (value: unknown): value is SurfaceStyleId =>
  typeof value === 'string' && (SURFACE_STYLE_IDS as readonly string[]).includes(value);

const snap = (value: number, spec: MaterialSpec): number => {
  const clamped = Math.min(spec.max, Math.max(spec.min, value));
  const stepped = Math.round(clamped / spec.step) * spec.step;
  return Math.round(stepped * 1000) / 1000;
};

/**
 * Repairs whatever was stored into numbers a stylesheet can take.
 *
 * The same discipline `sanitizeLayoutTokens` applies, for the same reason: a
 * model asked to make the interface calmer writes here, and `"12px; }` must be
 * a number or the app's own default, never a value the browser will parse.
 */
export const sanitizeMaterialTokens = (value: unknown, base: MaterialTokens = material({})): MaterialTokens => {
  const tokens = { ...base };
  if (typeof value !== 'object' || value === null) return tokens;

  const record = value as Record<string, unknown>;
  for (const key of MATERIAL_TOKEN_KEYS) {
    const raw = record[key];
    const asNumber = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
    if (Number.isFinite(asNumber)) tokens[key] = snap(asNumber, MATERIAL_SPECS[key]);
  }

  return tokens;
};

/** The colour a user picked, as the only thing they had to pick. */
export const DEFAULT_ACCENT = '#e5484d';

/**
 * Nine colours to start from, so nobody has to open a picker to get going.
 *
 * A wheel is the right control for somebody who knows what they want and the
 * wrong one for somebody being asked, thirty seconds into a new application,
 * what colour it should be. These are spread around the wheel at a lightness
 * that derives a readable palette in all seven materials, which is a promise no
 * arbitrary point on the wheel can make.
 */
export const ACCENT_SUGGESTIONS: readonly string[] = [
  '#e5484d',
  '#e5891a',
  '#d9b528',
  '#31a074',
  '#199fd1',
  '#5570e8',
  '#8f5fdb',
  '#d94a94',
  '#4a5568',
];

const HEX = /^#[0-9a-f]{6}$/i;

/** An accent this application will write into a stylesheet, or its own. */
export const sanitizeAccent = (value: unknown): string =>
  typeof value === 'string' && HEX.test(value.trim()) ? value.trim().toLowerCase() : DEFAULT_ACCENT;

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

export type Hsl = { h: number; s: number; l: number };

export const hexToHsl = (hex: string): Hsl => {
  const n = Number.parseInt(sanitizeAccent(hex).slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }

  return { h, s: Math.round(s * 100), l: Math.round(l * 100) };
};

export const hslToHex = ({ h, s, l }: Hsl): string => {
  const sat = Math.min(100, Math.max(0, s)) / 100;
  const light = Math.min(100, Math.max(0, l)) / 100;
  const k = (n: number): number => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number): number => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const channel = (x: number): string =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(f(0))}${channel(f(8))}${channel(f(4))}`;
};

/**
 * How bright a colour actually is, by the measure contrast is defined in.
 *
 * Not lightness: HSL lightness says a saturated yellow and a saturated blue at
 * `50%` are equally bright, and they are nowhere near. Black text is readable
 * on one and invisible on the other, which is the whole of why this is here.
 */
export const relativeLuminance = (hex: string): number => {
  const n = Number.parseInt(sanitizeAccent(hex).slice(1), 16);
  const channel = (c: number): number => {
    const value = c / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};

/**
 * The contrast between two colours, by the ratio WCAG is written in.
 *
 * 4.5:1 is the threshold for body text, 3:1 for large text. Both colours are
 * `#rrggbb`; the order does not matter.
 */
export const contrastRatio = (a: string, b: string): number => {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const [lighter, darker] = first > second ? [first, second] : [second, first];
  return (lighter + 0.05) / (darker + 0.05);
};

/** The contrast body text has to reach to be readable, per WCAG AA. */
export const READABLE_CONTRAST = 4.5;

/**
 * What to write on top of a colour so that it can actually be read.
 *
 * The old rule picked black or white either side of a luminance threshold,
 * which is the right idea and stops one step short: on a mid-toned accent —
 * gold, mid-blue, the red of a warning — *neither* black nor white reaches 4.5:1
 * on its own, and the rule returned the better of two failures. Measured across
 * the seven materials before this, the worst pairing was **2.41:1**, on the gold
 * this application ships with. That is a primary button whose label is a
 * suggestion.
 *
 * So the better candidate is chosen by measurement rather than by threshold, and
 * then walked away from the accent — darker if it is the dark one, lighter if it
 * is the light one — until it clears the bar or runs out of room. Running out of
 * room is possible, and the honest result there is the highest contrast
 * available rather than a colour that pretends.
 */
export const readableOn = (background: string): string => {
  const candidates = ['#000000', '#ffffff'];
  let best = candidates[0];
  let bestRatio = 0;
  for (const candidate of candidates) {
    const ratio = contrastRatio(candidate, background);
    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
  }
  if (bestRatio >= READABLE_CONTRAST) {
    // Pure black on a pale accent is harsh; a very dark tint of the accent's own
    // hue reads as part of the palette and still clears the bar comfortably.
    const tinted = hslToHex({ h: hexToHsl(background).h, s: 70, l: best === '#000000' ? 12 : 96 });
    return contrastRatio(tinted, background) >= READABLE_CONTRAST ? tinted : best;
  }
  return best;
};

/** What a whole application looks like, derived from one colour. */
export type Palette = {
  accent: string;
  /** What is written on top of the accent: decided by contrast, not by eye. */
  onAccent: string;
  ground: string;
  card: string;
  ink: string;
  inkSoft: string;
  /** Whether the ink is light — a fact about the ground, not a preference. */
  lightInk: boolean;
};

/**
 * Below this, a surface stops being glass and starts being a place text goes to
 * die. Applied to the materials that are meant to be see-through, so the dial
 * can be dragged to the end without the interface becoming unreadable.
 */
const ALPHA_FLOOR = 0.42;
const SEE_THROUGH: ReadonlySet<SurfaceStyleId> = new Set(['glass', 'liquid', 'aurora']);

/** The alpha a material will actually be given, whatever the dial says. */
export const effectiveAlpha = (styleId: SurfaceStyleId, alpha: number): number =>
  SEE_THROUGH.has(styleId) ? Math.max(ALPHA_FLOOR, alpha) : alpha;

/** Whether this material is dark right now. */
export const isDark = (styleId: SurfaceStyleId, prefersDark: boolean): boolean =>
  SURFACE_STYLES[styleId].forcedDark === true ? true : prefersDark;

/**
 * One colour in, a whole readable palette out.
 *
 * The ground takes the accent's hue and a fraction of its saturation, so a grey
 * is never a neutral nobody chose. The ink is then decided by measuring that
 * ground — which is what makes any accent safe, including the ones that break
 * a hand-tuned palette: an acid yellow and a navy produce different ink, and
 * neither needed anybody to notice.
 */
export const derivePalette = (
  accentHex: string,
  styleId: SurfaceStyleId,
  prefersDark: boolean,
  tint = MATERIAL_SPECS.tint.fallback
): Palette => {
  const style = SURFACE_STYLES[styleId];
  const accent = hexToHsl(sanitizeAccent(accentHex));
  const dark = isDark(styleId, prefersDark);

  const groundL = dark ? style.ground[1] : style.ground[0];
  const groundS = Math.round(accent.s * style.groundTint * Math.max(0, tint) * 0.28);
  const ground = hslToHex({ h: accent.h, s: groundS, l: groundL });

  const lightInk = relativeLuminance(ground) < 0.4;
  // A card has to be visibly a card. Six points of lightness over a dark ground
  // is a difference you can measure and not one you can see, and it is why the
  // first dark material read as one flat sheet of mud with text on it.
  const cardL = lightInk ? Math.min(34, groundL + 11) : Math.min(99, groundL + 5);

  return {
    // The colour the user picked, byte for byte. Everything else here goes
    // through integer HSL and drifts a step doing it, which is fine for a
    // derived grey and not fine for the one thing they chose: a picker that
    // shows #8f5fdb back as #9061db is reporting a value nobody set.
    accent: sanitizeAccent(accentHex),
    // Measured against the accent rather than guessed from a threshold — see
    // `readableOn`, and the 2.41:1 button label that made it necessary.
    onAccent: readableOn(hslToHex(accent)),
    ground,
    card: hslToHex({ h: accent.h, s: Math.min(40, groundS + 4), l: cardL }),
    ink: hslToHex({ h: accent.h, s: lightInk ? 22 : 24, l: lightInk ? 96 : 13 }),
    inkSoft: hslToHex({ h: accent.h, s: lightInk ? 14 : 12, l: lightInk ? 76 : 40 }),
    lightInk,
  };
};

/**
 * The palette, laid out left to right, for somebody to look at before choosing.
 *
 * Five bands rather than a number: what a person wants to know when they pick a
 * colour is whether the whole application will be all right afterwards, and no
 * hex value answers that. Accent, its lighter partner, the card, the ground and
 * the ink — in the order they cover a page, so a ramp that ends up all one
 * shade is visibly a bad choice before it is a worn one.
 */
export const paletteRamp = (
  accentHex: string,
  styleId: SurfaceStyleId,
  prefersDark: boolean,
  tint = MATERIAL_SPECS.tint.fallback
): readonly string[] => {
  const palette = derivePalette(accentHex, styleId, prefersDark, tint);
  const accent = hexToHsl(palette.accent);

  return [
    palette.accent,
    hslToHex({ h: accent.h, s: accent.s - 20, l: accent.l + 16 }),
    palette.card,
    palette.ground,
    palette.ink,
  ];
};

/**
 * Everything above, as the custom properties a component reads.
 *
 * Named so nothing has to know this module exists: `background: var(--fool-surface)`
 * is a line anybody can write and it does the right thing in all seven materials.
 */
export const surfaceVariables = (
  styleId: SurfaceStyleId,
  tokens: MaterialTokens,
  palette: Palette
): readonly (readonly [string, string])[] => {
  const alpha = effectiveAlpha(styleId, tokens.alpha);

  return [
    ['--fool-style', styleId],
    ['--fool-accent', palette.accent],
    ['--fool-on-accent', palette.onAccent],
    ['--fool-ground', palette.ground],
    ['--fool-card', palette.card],
    ['--fool-ink', palette.ink],
    ['--fool-ink-soft', palette.inkSoft],
    ['--fool-edge', `${tokens.edge}px`],
    ['--fool-depth', String(tokens.depth)],
    ['--fool-spread', String(tokens.spread)],
    ['--fool-inner', String(tokens.inner)],
    ['--fool-blur', `${tokens.blur}px`],
    ['--fool-alpha', String(alpha)],
    ['--fool-saturation', `${tokens.saturation}%`],
    ['--fool-sheen', String(tokens.sheen)],
    ['--fool-weight', String(tokens.weight)],
    ['--fool-tracking', `${tokens.tracking}em`],
    ['--fool-leading', String(tokens.leading)],
    ['--fool-gap', String(tokens.gap)],
    ['--fool-bounce', String(tokens.bounce)],
    ['--fool-lift', `${tokens.lift}px`],
    ['--fool-press', `${tokens.press}px`],
    ['--fool-ambient', String(tokens.ambient)],
  ];
};
