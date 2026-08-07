/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * JARVIS, as four layouts.
 *
 * These ship for a second reason besides being usable: they are what the layout
 * system looks like when somebody uses all of it. Every axis is chosen rather
 * than left, every dial is off its default, and every surface carries movements
 * built out of the same vocabulary the movement editor offers — so a person who
 * wears this and then opens the editor finds it already full of the thing they
 * are looking at, and can take it apart to see how it was done. A feature nobody
 * can see an example of is a feature nobody uses.
 *
 * The design is one idea applied four times: a projected display in a dark
 * workshop. Sharp corners because light drawn on glass has no rounding.
 * Slightly tightened air and a fraction smaller type, because a heads-up
 * display shows more than a document does. Fast, short movements that arrive
 * from one consistent direction, because a display *resolves* — it does not
 * slide in from wherever each element felt like.
 *
 * Kept in its own file rather than inside the built-in list because it is data
 * about one look, and the list of every shape the app ships is a different
 * thing. Also so that removing it, if it turns out nobody wants it, is deleting
 * a file rather than picking eight objects out of an array.
 */

import type { LayoutMotion } from './layoutMotions';
import { defaultLayoutTokens, type LayoutTokens } from './layoutTokens';
import type { LayoutOptions, LayoutPreset, SurfaceId } from './surfaceLayouts';

/** The id the JARVIS workspace names for each surface. */
export const JARVIS_LAYOUT_ID: Record<SurfaceId, string> = {
  voice: 'jarvis-reactor',
  chat: 'jarvis-readout',
  hub: 'jarvis-bay',
  frame: 'jarvis-hud',
};

/**
 * The dials, shared by all four.
 *
 * One set rather than four, because the point is that these surfaces belong to
 * each other. A display whose chat had different corners from its Hub would be
 * two displays.
 *
 * `radius: 0` is the load-bearing one. Light projected on glass has no rounded
 * corners, and rounding these would make the whole thing read as an app with a
 * blue theme rather than as a display.
 */
const hudTokens = (): LayoutTokens => ({
  ...defaultLayoutTokens(),
  radius: 0,
  spacing: 0.9,
  textScale: 0.95,
  // Quick, because an instrument answers immediately. Not zero, because
  // something that changes with no transition at all reads as a glitch rather
  // than as a response.
  motionMs: 140,
  accent: 1,
  // High, so a hairline is legible against a near-black ground.
  contrast: 0.8,
});

/**
 * A movement, written the way the builder writes them.
 *
 * The ids are placeholders — every path that stores a preset rebuilds them from
 * the target and the move, so what is written here only has to be distinct
 * enough to read.
 */
const move = (
  target: LayoutMotion['target'],
  motion: LayoutMotion['move'],
  durationMs: number,
  distancePx: number,
  easing: LayoutMotion['easing']
): LayoutMotion => ({ id: `${target}-${motion}`, target, move: motion, durationMs, distancePx, easing });

const preset = (
  surface: SurfaceId,
  name: string,
  options: Partial<LayoutOptions>,
  motions: LayoutMotion[]
): LayoutPreset => ({
  id: JARVIS_LAYOUT_ID[surface],
  name,
  surface,
  builtin: true,
  options: {
    shell: 'instrument',
    meter: 'bars',
    bubbles: 'bubbles',
    cards: 'grid',
    sider: 'left',
    titlebar: 'full',
    panel: 'inline',
    motion: 'full',
    density: 'comfortable',
    ...options,
  },
  tokens: hudTokens(),
  motions,
});

export const JARVIS_LAYOUTS: readonly LayoutPreset[] = [
  /**
   * The voice page as the reactor.
   *
   * `hud` and `ring` because this is the one surface whose subject is a level,
   * and a ring is what a level looks like on an instrument rather than on a
   * mixing desk. The settings go behind a drawer so the conversation has the
   * screen: when you are talking to it you are not adjusting it.
   */
  preset('voice', 'JARVIS · Reactor', { shell: 'hud', meter: 'ring', panel: 'drawer' }, []),

  /**
   * The conversation as a readout.
   *
   * Flat rather than bubbles, which is the choice that makes this feel like an
   * instrument instead of a messaging app — a display prints lines, it does not
   * put each one in a shape. Messages rise a short distance as they land,
   * because that is what a line of new output does.
   */
  preset('chat', 'JARVIS · Readout', { bubbles: 'flat', panel: 'drawer', density: 'compact' }, [
    move('message', 'rise', 180, 8, 'sharp'),
  ]),

  /**
   * The Hub as the bay: workspaces on shelves.
   *
   * A list rather than a gallery, because a workshop keeps its things in rows
   * where they can be read down. Each card arrives from the left, the direction
   * the eye already travels, and springs very slightly — the one place in the
   * whole theme that overshoots, so that picking a workspace feels like taking
   * something off a rack.
   */
  preset('hub', 'JARVIS · Bay', { cards: 'list', density: 'compact' }, [
    move('card', 'in-from-left', 260, 18, 'spring'),
  ]),

  /**
   * The frame as the display housing.
   *
   * The sidebar moves to the right, which is the choice people find strangest
   * and is the reason it is here: it is the clearest demonstration that the
   * frame is genuinely re-arrangeable, and on a wide screen it puts the
   * instrument column under the hand that is already on the mouse. The title bar
   * goes slim because a heads-up display gives its top edge to the display.
   */
  preset('frame', 'JARVIS · HUD', { sider: 'right', titlebar: 'slim', density: 'compact' }, [
    move('sider', 'in-from-right', 220, 16, 'smooth'),
    move('titlebar', 'fall', 200, 6, 'sharp'),
  ]),
];
