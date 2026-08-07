/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import { configService } from '@/common/config/configService';
import {
  LAYOUT_PRESETS_CONFIG_KEY,
  resolveLayout,
  sanitizeLayoutPresets,
  sanitizeSurfaceLayouts,
  SURFACE_IDS,
  SURFACE_LAYOUT_CONFIG_KEY,
} from '@/common/config/surfaceLayouts';
import { applyLayoutMotions } from '@renderer/utils/theme/applyLayoutMotions';
import { applySurfaceShape } from '@renderer/utils/theme/applySurfaceShape';

/**
 * Keeps every surface's chosen shape on the document, whichever page is open.
 *
 * Mounted once at the app root rather than per page, because three of the four
 * surfaces need their shape to be in force before they are looked at. The frame
 * is the clearest case — the sidebar is drawn by the shell, not by the page
 * inside it, so a hook that only ran when the frame's "page" mounted would never
 * run at all. Publishing all four costs one read and makes the rule uniform:
 * a shape is a fact about the app, not a side effect of navigation.
 *
 * `useSurfaceLayout` stays what a page calls when it needs to *read* its own
 * layout — the voice page swaps compositions in JSX and genuinely needs the
 * value. This is the other half: everything expressible in CSS, applied
 * centrally, so a surface obeys its layout without being rewritten.
 */
export const useSurfaceShapes = (): void => {
  useEffect(() => {
    const publish = (): void => {
      const selection = sanitizeSurfaceLayouts(configService.get(SURFACE_LAYOUT_CONFIG_KEY));
      const presets = sanitizeLayoutPresets(configService.get(LAYOUT_PRESETS_CONFIG_KEY));

      for (const surface of SURFACE_IDS) {
        const worn = resolveLayout(surface, selection, presets);
        applySurfaceShape(surface, worn.options);
        // The movements go on with the shape. They are part of the layout, so a
        // layout worn without them would be worn in part.
        applyLayoutMotions(surface, worn.motions);
      }
    };

    publish();
    // Both keys: editing a preset changes what a selection resolves to even
    // though the selection itself did not move.
    const offSelection = configService.subscribe(SURFACE_LAYOUT_CONFIG_KEY, publish);
    const offPresets = configService.subscribe(LAYOUT_PRESETS_CONFIG_KEY, publish);

    return () => {
      offSelection();
      offPresets();
    };
  }, []);
};
