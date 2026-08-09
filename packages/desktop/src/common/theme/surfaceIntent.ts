/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * "Make the corners rounder" as something the application can actually do.
 *
 * The dials are numbers, and a person does not say numbers. They say softer,
 * calmer, deeper, less glassy — a direction and a thing, never a value. This
 * turns that into the one it is: a material to wear, or a dial and which way to
 * move it.
 *
 * It exists as its own module, pure, because three callers need exactly the
 * same behaviour and must not each invent it: the spoken conversation, typed
 * chat through the app-tools channel, and a hosted CLI agent through the
 * bridge. A sentence said out loud and a sentence typed have to change the same
 * thing by the same amount, or the application has two answers to one question.
 */

import { resolveTokens, type SurfaceStyleChoice } from '@/common/theme/surfaceChoice';
import {
  MATERIAL_SPECS,
  MATERIAL_TOKEN_KEYS,
  isSurfaceStyleId,
  sanitizeAccent,
  type MaterialTokenKey,
  type SurfaceStyleId,
} from '@/common/theme/surfaceStyle';

/** Which way a dial was asked to move, when no number was given. */
export type Direction = 'more' | 'less';

export type SurfaceIntent = {
  /** Wear this material. */
  material?: SurfaceStyleId;
  /** Derive everything from this colour. */
  accent?: string;
  /** Move this dial. */
  dial?: MaterialTokenKey;
  /** To exactly here. */
  amount?: number;
  /** Or by one noticeable step, this way. */
  direction?: Direction;
};

/**
 * How far one nudge goes.
 *
 * A tenth of the dial's whole range: small enough that "a bit warmer" said
 * twice is not the same as shouting, large enough that saying it once is
 * visible. A step of the control itself would be too small to see on the wide
 * dials and too coarse on the narrow ones.
 */
const NUDGE = 0.1;

const nudge = (key: MaterialTokenKey, from: number, direction: Direction): number => {
  const spec = MATERIAL_SPECS[key];
  const distance = (spec.max - spec.min) * NUDGE;
  const moved = direction === 'more' ? from + distance : from - distance;
  return Math.min(spec.max, Math.max(spec.min, moved));
};

/** True when the value names a dial this application has. */
export const isDialKey = (value: unknown): value is MaterialTokenKey =>
  typeof value === 'string' && (MATERIAL_TOKEN_KEYS as readonly string[]).includes(value);

/**
 * The intent, read out of whatever the model sent.
 *
 * Everything unrecognised is dropped rather than guessed at. A model that asks
 * for a material this application does not have has asked for nothing, and
 * doing something else instead — the nearest one, the default one — is how an
 * assistant ends up changing something nobody mentioned.
 */
export const readSurfaceIntent = (args: Record<string, unknown>): SurfaceIntent => {
  const intent: SurfaceIntent = {};

  if (isSurfaceStyleId(args.material)) intent.material = args.material;
  if (typeof args.color === 'string' && sanitizeAccent(args.color) === args.color.trim().toLowerCase()) {
    intent.accent = sanitizeAccent(args.color);
  }
  if (isDialKey(args.dial)) intent.dial = args.dial;

  const amount = typeof args.amount === 'number' ? args.amount : Number(args.amount);
  if (Number.isFinite(amount)) intent.amount = amount;

  if (args.direction === 'more' || args.direction === 'less') intent.direction = args.direction;

  return intent;
};

/** What the intent changes, in the words a reply is built from. */
export type SurfaceChange = {
  choice: SurfaceStyleChoice;
  /** What actually moved. Empty means nothing did, and the caller must say so. */
  changed: readonly ('material' | 'accent' | MaterialTokenKey)[];
};

/**
 * The intent, applied to what is being worn.
 *
 * A material and a dial in the same sentence is a real request — "switch to
 * glass and calm it down" — so both are taken, in that order: the dial is moved
 * from the new material's own value, not from the old one's, which is what the
 * person meant.
 */
export const applySurfaceIntent = (current: SurfaceStyleChoice, intent: SurfaceIntent): SurfaceChange => {
  const changed: ('material' | 'accent' | MaterialTokenKey)[] = [];
  let choice: SurfaceStyleChoice = current;

  if (intent.material !== undefined && intent.material !== current.style) {
    // Wearing a material drops the dials moved for the last one, the same as
    // choosing it in the panel does.
    choice = { style: intent.material, accent: choice.accent };
    changed.push('material');
  }

  if (intent.accent !== undefined && intent.accent !== choice.accent) {
    choice = { ...choice, accent: intent.accent };
    changed.push('accent');
  }

  if (intent.dial !== undefined) {
    const spec = MATERIAL_SPECS[intent.dial];
    const from = resolveTokens(choice)[intent.dial];
    const to =
      intent.amount !== undefined
        ? Math.min(spec.max, Math.max(spec.min, intent.amount))
        : intent.direction !== undefined
          ? nudge(intent.dial, from, intent.direction)
          : from;

    if (to !== from) {
      choice = { ...choice, tokens: { ...(choice.tokens ?? {}), [intent.dial]: to } };
      changed.push(intent.dial);
    }
  }

  return { choice, changed };
};
