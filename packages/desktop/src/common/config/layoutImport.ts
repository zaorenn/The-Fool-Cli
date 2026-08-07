/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reading back a preset that some other AI wrote.
 *
 * The text arriving here was produced by a model the app has never seen, from a
 * prompt the app cannot check, possibly edited by hand on the way, and dropped
 * in as a file. So this is a parser for hostile input that happens to usually be
 * friendly — and the way it stays safe is by not being clever: every field goes
 * through the same sanitisers a stored preset goes through, and anything they do
 * not recognise is dropped rather than repaired.
 *
 * The failures are named rather than swallowed. Somebody who pasted the model's
 * apology instead of its JSON needs to be told that is what happened; a drop
 * zone that quietly does nothing is indistinguishable from a broken one, and
 * they will conclude the feature does not work rather than that they copied the
 * wrong thing.
 */

import { sanitizeMotions, type LayoutMotion } from './layoutMotions';
import { sanitizeLayoutTokens, type LayoutTokens } from './layoutTokens';
import {
  normalizeLayoutName,
  sanitizeLayoutOptions,
  SURFACE_IDS,
  type LayoutOptions,
  type SurfaceId,
} from './surfaceLayouts';

export type ImportedLayout = {
  name: string;
  surface: SurfaceId;
  options: LayoutOptions;
  tokens: LayoutTokens;
  motions: LayoutMotion[];
};

/**
 * Why a file could not be read, in terms of what the person did.
 *
 * `not-json` and `no-surface` are the two that actually happen: the first is
 * pasting the model's prose along with the JSON, the second is a model inventing
 * a window name. Both are the person's to fix, and both are fixable in seconds
 * once they are told which one it is.
 */
export type ImportFailure = 'empty' | 'not-json' | 'not-a-preset' | 'no-surface' | 'no-name';

export type ImportResult = { status: 'ok'; layout: ImportedLayout } | { status: 'failed'; reason: ImportFailure };

/**
 * The JSON out of whatever was pasted.
 *
 * Models put their answer in a fenced block more often than not, and a person
 * copying it takes the fence with it. Refusing that is technically correct and
 * practically useless, so the fence is stripped and, failing that, the outermost
 * braces are taken — which covers "here is your preset:" followed by the object.
 */
const jsonOf = (raw: string): unknown => {
  const text = raw.trim();
  if (text.length === 0) return undefined;

  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  const candidates = [fenced?.[1], text];

  const braced = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  if (braced.length > 1) candidates.push(braced);

  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    try {
      return JSON.parse(candidate.trim());
    } catch {
      // The next candidate, or a named failure once they run out.
    }
  }

  return undefined;
};

/**
 * A preset out of arbitrary text, or the reason there is not one.
 *
 * `builtin` is never read from the data and the id is never taken from it: an
 * imported file claiming to be one of the app's own would be a preset nobody can
 * delete, and one claiming an existing id would overwrite something the person
 * made. Both are decided here, from the name, exactly as they are when somebody
 * saves a preset by hand.
 */
export const readLayoutFile = (raw: string): ImportResult => {
  if (raw.trim().length === 0) return { status: 'failed', reason: 'empty' };

  const parsed = jsonOf(raw);
  if (parsed === undefined) return { status: 'failed', reason: 'not-json' };
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { status: 'failed', reason: 'not-a-preset' };
  }

  const record = parsed as Record<string, unknown>;

  const surface = SURFACE_IDS.find((entry) => entry === record.surface);
  if (!surface) return { status: 'failed', reason: 'no-surface' };

  const name = typeof record.name === 'string' ? record.name.trim().slice(0, 48) : '';
  if (normalizeLayoutName(name).length === 0) return { status: 'failed', reason: 'no-name' };

  return {
    status: 'ok',
    layout: {
      name,
      surface,
      // Each of these drops what it does not know rather than failing, so a
      // model that got four fields right and one wrong still produces the
      // preset it meant — with the fifth left as the app's default.
      options: sanitizeLayoutOptions(record.options, surface),
      tokens: sanitizeLayoutTokens(record.tokens),
      motions: sanitizeMotions(record.motions),
    },
  };
};
