/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { motionStylesheet, type LayoutMotion } from '@/common/config/layoutMotions';
import { SURFACE_IDS, type SurfaceId } from '@/common/config/surfaceLayouts';

/**
 * Putting a built movement on the page.
 *
 * One style element per surface, rewritten whole — the same shape as the theme
 * overrides and the token dials, and for the same reason. Appending would leave
 * the previous version underneath, so deleting a movement would not remove it;
 * it would go on playing with no entry in the list to explain why.
 *
 * Per surface rather than one element for all four so that wearing a new chat
 * layout replaces the chat's movements and leaves the Hub's alone. A single
 * element would make every surface's motions one write, and switching one
 * surface would silently drop the others.
 */

const styleId = (surface: SurfaceId): string => `fool-layout-motions-${surface}`;

const styleElement = (surface: SurfaceId): HTMLStyleElement | null => {
  if (typeof document === 'undefined') return null;

  const existing = document.getElementById(styleId(surface));
  if (existing instanceof HTMLStyleElement) {
    // Moved to the end, for the reason the dials are: a theme applied afterwards
    // would otherwise sit on top of a movement the user built.
    document.head.appendChild(existing);
    return existing;
  }

  const created = document.createElement('style');
  created.id = styleId(surface);
  document.head.appendChild(created);
  return created;
};

/** What each surface last applied, so anything rewriting the head can re-assert it. */
const lastApplied = new Map<SurfaceId, readonly LayoutMotion[]>();

export const applyLayoutMotions = (surface: SurfaceId, motions: readonly LayoutMotion[]): void => {
  lastApplied.set(surface, motions);

  const element = styleElement(surface);
  if (!element) return;

  // Empty when nothing was built. Somebody who never opened the movement editor
  // gets no stylesheet at all rather than one asserting that nothing moves.
  element.textContent = motionStylesheet(surface, motions);
};

/** Puts back what was built, for anything that has just rewritten the head. */
export const reapplyLayoutMotions = (): void => {
  for (const surface of SURFACE_IDS) applyLayoutMotions(surface, lastApplied.get(surface) ?? []);
};
