/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { allShapeAttributeNames, surfaceShapeAttributes } from '@/common/config/surfaceShape';
import { SURFACE_IDS, type LayoutOptions, type SurfaceId } from '@/common/config/surfaceLayouts';

/**
 * Putting a surface's chosen shape where the stylesheet can see it.
 *
 * Sibling of `applyLayoutTokens`, and deliberately the same shape of thing: the
 * document root is the one place every surface's CSS can reach, whether or not
 * that surface is currently mounted. The frame's sidebar setting has to be
 * legible to a rule that styles the sidebar, which is not inside the page whose
 * settings changed it — passing it down as props would mean threading a layout
 * decision through every component between them.
 *
 * Written as attributes rather than as classes so a value can be *read* as well
 * as matched: `[data-fool-chat-bubbles='flat']` says which of two things is on,
 * where two classes would leave the question of what happens when both or
 * neither are present.
 */

/** Puts one surface's shape on the document, replacing whatever it had. */
export const applySurfaceShape = (surface: SurfaceId, options: LayoutOptions): void => {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  for (const [name, value] of surfaceShapeAttributes(surface, options)) root.setAttribute(name, value);
};

/** Takes every shape attribute off, for a preview that must start from nothing. */
export const clearSurfaceShapes = (): void => {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  for (const name of allShapeAttributeNames(SURFACE_IDS)) root.removeAttribute(name);
};
