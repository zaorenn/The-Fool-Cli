/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * How a surface is laid out, chosen per surface and kept by name.
 *
 * A theme decides what the app is *coloured* like and every window obeys it.
 * This is the other axis: what a particular window is *shaped* like. They are
 * genuinely different questions — someone can want The Fool's crimson everywhere
 * and want the voice page to be a dial rather than a column — and answering both
 * with one setting would mean picking a look you did not want to get a shape you
 * did.
 *
 * Deliberately options rather than a page builder. A layout is a small set of
 * named decisions — which composition draws it, how the level is shown, where
 * the settings live, how much it moves — and a preset is those decisions under a
 * name. That is enough for someone to build the surface they want and small
 * enough that every combination can be made to work; a free-form canvas would be
 * neither.
 *
 * Shared by main and renderer, so no DOM access here. Everything is plain data
 * and every read is sanitised, because these values come back from a config
 * store the user and a language model can both write to.
 */

import { sanitizeMotions, type LayoutMotion } from './layoutMotions';
import { defaultLayoutTokens, sanitizeLayoutTokens, type LayoutTokens } from './layoutTokens';

/** A window whose shape can be chosen. */
export type SurfaceId = 'voice' | 'chat' | 'hub' | 'frame';

export const SURFACE_IDS: readonly SurfaceId[] = ['voice', 'chat', 'hub', 'frame'];

/**
 * The decisions a layout is made of, across every surface.
 *
 * One flat shape rather than a type per surface, because these are stored,
 * spoken about and sanitised as one thing, and a union would put a cast at every
 * one of those boundaries to buy nothing. Which of these keys a given surface
 * actually answers is `SURFACE_OPTION_KEYS` below — a level meter is not a
 * question the Hub has an opinion about.
 *
 * Every one of these is something a person can say out loud about a screen, and
 * every combination has to be usable — there is no option here that only makes
 * sense next to one value of another.
 */
export type LayoutOptions = {
  /** Which composition draws the voice surface. */
  shell: 'instrument' | 'hud';
  /** How the sound is drawn: a straight meter, or wrapped into a ring. */
  meter: 'bars' | 'ring';
  /** Whether a message is drawn as a bubble or as a line of a transcript. */
  bubbles: 'bubbles' | 'flat';
  /** Whether the Hub shows its workspaces as a gallery or as a list. */
  cards: 'grid' | 'list';
  /** Which side the sidebar is on, or whether it is there at all. */
  sider: 'left' | 'right' | 'hidden';
  /** How much room the title bar takes. */
  titlebar: 'full' | 'slim';
  /** Whether the settings sit beside the conversation or slide over it. */
  panel: 'inline' | 'drawer';
  /** How much the surface moves. `none` is the accessibility floor, not a style. */
  motion: 'full' | 'calm' | 'none';
  /** How tightly the type and spacing are set. */
  density: 'comfortable' | 'compact';
};

export type LayoutOptionKey = keyof LayoutOptions;

/**
 * What each option may be, in the order a picker should offer it.
 *
 * The single source for both validation and the settings page, so an option
 * added here appears in the interface and survives a round trip without a second
 * edit somewhere else.
 */
export const LAYOUT_OPTION_VALUES: { [K in LayoutOptionKey]: readonly LayoutOptions[K][] } = {
  shell: ['instrument', 'hud'],
  meter: ['bars', 'ring'],
  bubbles: ['bubbles', 'flat'],
  cards: ['grid', 'list'],
  sider: ['left', 'right', 'hidden'],
  titlebar: ['full', 'slim'],
  panel: ['inline', 'drawer'],
  motion: ['full', 'calm', 'none'],
  density: ['comfortable', 'compact'],
};

export const LAYOUT_OPTION_KEYS = Object.keys(LAYOUT_OPTION_VALUES) as LayoutOptionKey[];

/**
 * Which questions each surface actually answers.
 *
 * Showing somebody a level-meter switch on the sidebar page is how a settings
 * screen stops being trusted: they turn it, nothing happens, and now no dial on
 * the page is believable. So the editor asks a surface what it has an opinion
 * about, and a stored value for a key outside that list is ignored rather than
 * worn.
 *
 * `motion` and `density` are on every surface deliberately. They mean the same
 * thing everywhere, and splitting them per surface would make "calm the whole
 * app down" four separate errands.
 */
export const SURFACE_OPTION_KEYS: Record<SurfaceId, readonly LayoutOptionKey[]> = {
  voice: ['shell', 'meter', 'panel', 'motion', 'density'],
  chat: ['bubbles', 'panel', 'motion', 'density'],
  hub: ['cards', 'motion', 'density'],
  frame: ['sider', 'titlebar', 'motion', 'density'],
};

export const surfaceOptionKeys = (surface: SurfaceId): readonly LayoutOptionKey[] =>
  SURFACE_OPTION_KEYS[surface] ?? SURFACE_OPTION_KEYS.voice;

/** One named shape for one surface. */
export type LayoutPreset = {
  /** Stable id. For a user's own, derived from the name they gave it. */
  id: string;
  /** What to call it. The user's own words for one they made. */
  name: string;
  surface: SurfaceId;
  /** True for one that ships with the app and cannot be edited or deleted. */
  builtin: boolean;
  options: LayoutOptions;
  /**
   * The dials behind the look: corners, air, motion, text size.
   *
   * Separate from the options because they are a different kind of decision.
   * An option is a choice between compositions somebody designed; these are
   * numbers the user turns until it looks right, which is the difference
   * between picking a look and having one.
   */
  tokens: LayoutTokens;
  /**
   * Movements the user built, which the app has none of until they do.
   *
   * Part of the layout rather than a setting beside it, for the same reason the
   * dials are: someone who made a shape where messages rise into place means
   * that as part of the shape. Wearing the layout and not getting the movement
   * would be wearing half of it.
   */
  motions: LayoutMotion[];
};

/**
 * The shapes that ship.
 *
 * `instrument` is what the page has been: a straight level meter, the settings
 * in a column beside it. It stays the default, because a layout arriving in an
 * update and rearranging someone's screen is not an improvement however good it
 * is.
 *
 * `hud` is the dial: the level wrapped into a ring, the agent's work as a trace
 * rather than a stack of cards, and the settings behind a drawer so the
 * conversation has the screen to itself.
 */
const baseOptions: LayoutOptions = {
  shell: 'instrument',
  meter: 'bars',
  bubbles: 'bubbles',
  cards: 'grid',
  sider: 'left',
  titlebar: 'full',
  panel: 'inline',
  motion: 'full',
  density: 'comfortable',
};

export const BUILTIN_LAYOUTS: readonly LayoutPreset[] = [
  {
    id: 'instrument',
    name: 'Instrument',
    surface: 'voice',
    builtin: true,
    options: { ...baseOptions },
    tokens: defaultLayoutTokens(),
    motions: [],
  },
  {
    id: 'hud',
    name: 'HUD',
    surface: 'voice',
    builtin: true,
    options: { ...baseOptions, shell: 'hud', meter: 'ring', panel: 'drawer' },
    tokens: defaultLayoutTokens(),
    motions: [],
  },
  // Chat. `column` is the app as it has always drawn a conversation, so an
  // update leaves an existing screen exactly where its owner left it.
  {
    id: 'column',
    name: 'Column',
    surface: 'chat',
    builtin: true,
    options: { ...baseOptions },
    tokens: defaultLayoutTokens(),
    motions: [],
  },
  {
    id: 'transcript',
    name: 'Transcript',
    surface: 'chat',
    builtin: true,
    options: { ...baseOptions, bubbles: 'flat', panel: 'drawer', density: 'compact' },
    tokens: defaultLayoutTokens(),
    motions: [],
  },
  // Hub.
  {
    id: 'gallery',
    name: 'Gallery',
    surface: 'hub',
    builtin: true,
    options: { ...baseOptions },
    tokens: defaultLayoutTokens(),
    motions: [],
  },
  {
    id: 'index',
    name: 'Index',
    surface: 'hub',
    builtin: true,
    options: { ...baseOptions, cards: 'list', density: 'compact' },
    tokens: defaultLayoutTokens(),
    motions: [],
  },
  // The frame every surface sits inside.
  {
    id: 'standard',
    name: 'Standard',
    surface: 'frame',
    builtin: true,
    options: { ...baseOptions },
    tokens: defaultLayoutTokens(),
    motions: [],
  },
  {
    id: 'focused',
    name: 'Focused',
    surface: 'frame',
    builtin: true,
    options: { ...baseOptions, sider: 'hidden', titlebar: 'slim', density: 'compact' },
    tokens: defaultLayoutTokens(),
    motions: [],
  },
];

/**
 * The shape a surface has when nothing has been chosen.
 *
 * Every one of these reproduces what the app drew before it could be shaped at
 * all. A layout arriving in an update and rearranging somebody's screen is not
 * an improvement however good the new one is.
 */
export const DEFAULT_LAYOUT_ID: Record<SurfaceId, string> = {
  voice: 'instrument',
  chat: 'column',
  hub: 'gallery',
  frame: 'standard',
};

export const defaultLayoutOptions = (surface: SurfaceId): LayoutOptions => {
  const preset = BUILTIN_LAYOUTS.find((entry) => entry.id === DEFAULT_LAYOUT_ID[surface]);
  return preset ? { ...preset.options } : { ...baseOptions };
};

/** Which layout each surface is currently wearing. */
export const SURFACE_LAYOUT_CONFIG_KEY = 'ui.surfaceLayouts';

/** The ones the user made, which is a library rather than a state. */
export const LAYOUT_PRESETS_CONFIG_KEY = 'ui.layoutPresets';

/** The most a user may keep, oldest dropped first. */
export const MAX_LAYOUT_PRESETS = 24;

export type SurfaceLayoutSelection = Partial<Record<SurfaceId, string>>;

export type LayoutPresetLibrary = Record<string, LayoutPreset>;

/**
 * Trimmed, lower-cased and short enough to be said aloud.
 *
 * The same rule palettes use, and for the same reason: these are recalled by
 * voice — "put my quiet one back on" only works if the name is matched the way a
 * person says it rather than the way they typed it.
 */
export const normalizeLayoutName = (name: string): string =>
  name.trim().toLowerCase().replaceAll(/\s+/g, ' ').slice(0, 48);

/** Drops anything that is not a value this version knows. */
export const sanitizeLayoutOptions = (value: unknown, surface: SurfaceId = 'voice'): LayoutOptions => {
  const base = defaultLayoutOptions(surface);
  if (typeof value !== 'object' || value === null) return base;

  const record = value as Record<string, unknown>;
  const options = { ...base };

  // Only the questions this surface answers. A stored `meter` on the Hub is not
  // repaired into something meaningful — it is simply not one of the Hub's
  // decisions, and carrying it would let a picker offer a switch that does
  // nothing.
  for (const key of surfaceOptionKeys(surface)) {
    const raw = record[key];
    const allowed = LAYOUT_OPTION_VALUES[key] as readonly string[];
    if (typeof raw === 'string' && allowed.includes(raw)) {
      // Each key's value type is its own; the check above is what proves it.
      (options as Record<string, string>)[key] = raw;
    }
  }

  return options;
};

/**
 * Repairs the library of user-made layouts.
 *
 * A preset that cannot be read is dropped rather than repaired into something
 * the user did not save, and a name colliding with a built-in is refused: a
 * layout called "hud" that is not the HUD would make every later reference to it
 * ambiguous, including a spoken one.
 */
export const sanitizeLayoutPresets = (value: unknown): LayoutPresetLibrary => {
  if (typeof value !== 'object' || value === null) return {};

  const builtinIds = new Set(BUILTIN_LAYOUTS.map((preset) => preset.id));
  const library: LayoutPresetLibrary = {};

  for (const [rawName, rawPreset] of Object.entries(value as Record<string, unknown>)) {
    const name = normalizeLayoutName(rawName);
    if (name.length === 0 || builtinIds.has(name)) continue;
    if (typeof rawPreset !== 'object' || rawPreset === null) continue;

    const record = rawPreset as {
      surface?: unknown;
      options?: unknown;
      name?: unknown;
      tokens?: unknown;
      motions?: unknown;
    };
    const surface = SURFACE_IDS.includes(record.surface as SurfaceId) ? (record.surface as SurfaceId) : 'voice';

    library[name] = {
      id: name,
      name: typeof record.name === 'string' && record.name.trim().length > 0 ? record.name.trim().slice(0, 48) : name,
      surface,
      builtin: false,
      options: sanitizeLayoutOptions(record.options, surface),
      tokens: sanitizeLayoutTokens(record.tokens),
      motions: sanitizeMotions(record.motions),
    };
  }

  // Oldest first, so a library kept out loud never grows without bound.
  const kept = Object.entries(library).slice(-MAX_LAYOUT_PRESETS);
  return Object.fromEntries(kept);
};

/** Repairs the per-surface selection, dropping surfaces this version does not have. */
export const sanitizeSurfaceLayouts = (value: unknown): SurfaceLayoutSelection => {
  if (typeof value !== 'object' || value === null) return {};

  const record = value as Record<string, unknown>;
  const selection: SurfaceLayoutSelection = {};

  for (const surface of SURFACE_IDS) {
    const raw = record[surface];
    if (typeof raw === 'string' && raw.trim().length > 0) selection[surface] = normalizeLayoutName(raw);
  }

  return selection;
};

/** Every layout a surface can wear right now, built-ins first. */
export const layoutsForSurface = (surface: SurfaceId, presets: LayoutPresetLibrary): LayoutPreset[] => [
  ...BUILTIN_LAYOUTS.filter((preset) => preset.surface === surface),
  ...Object.values(presets).filter((preset) => preset.surface === surface),
];

/**
 * The options a surface is actually wearing.
 *
 * Falls back rather than failing: a selection naming a preset the user has since
 * deleted resolves to the surface's default, because a window that refuses to
 * draw is worse than one drawn the way it shipped.
 */
export const resolveLayout = (
  surface: SurfaceId,
  selection: SurfaceLayoutSelection,
  presets: LayoutPresetLibrary
): LayoutPreset => {
  const wanted = selection[surface];
  const available = layoutsForSurface(surface, presets);

  const found = wanted ? available.find((preset) => preset.id === normalizeLayoutName(wanted)) : undefined;
  if (found) return found;

  return (
    available.find((preset) => preset.id === DEFAULT_LAYOUT_ID[surface]) ??
    available[0] ?? {
      id: DEFAULT_LAYOUT_ID[surface],
      name: DEFAULT_LAYOUT_ID[surface],
      surface,
      builtin: true,
      options: defaultLayoutOptions(surface),
      tokens: defaultLayoutTokens(),
      motions: [],
    }
  );
};

/**
 * Finds a layout by whatever the user called it, for a spoken request.
 *
 * Matched on the normalised name and then loosely, because "put the heads-up one
 * on" is how someone refers to a thing they named once. Exact first so a preset
 * named after a built-in prefix cannot shadow it.
 */
export const findLayoutByName = (
  surface: SurfaceId,
  name: string,
  presets: LayoutPresetLibrary
): LayoutPreset | null => {
  const wanted = normalizeLayoutName(name);
  if (wanted.length === 0) return null;

  const available = layoutsForSurface(surface, presets);
  const exact = available.find((preset) => preset.id === wanted || normalizeLayoutName(preset.name) === wanted);
  if (exact) return exact;

  return (
    available.find((preset) => {
      const label = normalizeLayoutName(preset.name);
      return label.includes(wanted) || wanted.includes(label);
    }) ?? null
  );
};
