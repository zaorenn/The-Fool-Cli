/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Every orb there is, and the one to draw when the setting names something
 * that is not here any more.
 *
 * The registry exists so that adding a look is one import and one array entry.
 * Nothing else in the application knows the name of a skin: the pet window asks
 * for whatever is configured, the settings page lists what this exports, and a
 * skin removed in a later version falls back rather than leaving somebody with
 * an empty window and no way to work out why.
 */

import { DEFAULT_ORB_SKIN } from '@/common/config/configKeys';
import { reactorSkin } from './reactorSkin';
import { pulseSkin } from './pulseSkin';
import type { OrbSkin } from './types';

export const ORB_SKINS: readonly OrbSkin[] = [reactorSkin, pulseSkin];

/**
 * The skin with this id, or the default.
 *
 * Never throws and never returns nothing. A window that cannot draw is
 * indistinguishable from a window that crashed, and the id comes from a config
 * file a user can edit by hand.
 */
export const orbSkinById = (id: string | undefined): OrbSkin => {
  const found = ORB_SKINS.find((skin) => skin.id === id);
  if (found) return found;
  const fallback = ORB_SKINS.find((skin) => skin.id === DEFAULT_ORB_SKIN);
  // The array is not empty and `DEFAULT_ORB_SKIN` names a member of it, but
  // both are ordinary values somebody can edit, so the last resort is the first
  // entry rather than a crash in a window with no console anybody will read.
  return fallback ?? ORB_SKINS[0];
};
