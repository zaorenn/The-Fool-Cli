/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A chosen shape, expressed as something a stylesheet can answer.
 *
 * The voice page could be shaped by swapping whole compositions because someone
 * wrote two of them. That does not scale to every window in the app — nobody is
 * going to write a second Hub, a second sidebar and a second conversation view,
 * and if shaping a surface required that, then "customise the app" would keep
 * meaning "customise the one page we got round to".
 *
 * So a shape is published as attributes on the document root and the rules live
 * in CSS. A surface obeys its layout by existing; the stylesheet does the work.
 * That is what lets the editor offer four surfaces honestly, and it is the same
 * hook the animation builder writes against, so a user-made motion and a shipped
 * composition are the same kind of thing rather than two systems that have to
 * agree.
 *
 * Shared by main and renderer, so nothing here touches the DOM. This turns a
 * choice into names and values; putting them on the page is the renderer's job.
 */

import { surfaceOptionKeys, type LayoutOptionKey, type LayoutOptions, type SurfaceId } from './surfaceLayouts';

/**
 * The prefix every shape attribute carries.
 *
 * Its own namespace so a rule can never be confused with Arco's own data
 * attributes or with the theme's, and so everything the layout system puts on
 * the document can be found — and removed — by one selector.
 */
export const SHAPE_ATTRIBUTE_PREFIX = 'data-fool-';

/**
 * What one axis of one surface is called on the document.
 *
 * Qualified by surface deliberately. `density` means something on all four, and
 * an unqualified `data-fool-density` would make the Hub's density and the chat's
 * density the same attribute — so choosing compact in one place would quietly
 * compact the other, which is exactly the sort of thing that makes a settings
 * page feel haunted.
 */
export const shapeAttributeName = (surface: SurfaceId, key: LayoutOptionKey): string =>
  `${SHAPE_ATTRIBUTE_PREFIX}${surface}-${key}`;

/**
 * Every attribute a surface's shape puts on the document, ready to be set.
 *
 * Only the axes the surface answers: publishing `data-fool-hub-meter` would
 * invite a stylesheet rule for a decision the Hub does not have, and that rule
 * would work right up until somebody wondered why the level meter setting moved
 * their workspace cards.
 */
export const surfaceShapeAttributes = (surface: SurfaceId, options: LayoutOptions): Array<[string, string]> =>
  surfaceOptionKeys(surface).map((key) => [shapeAttributeName(surface, key), String(options[key])]);

/** Every attribute name the layout system may own, for clearing them all. */
export const allShapeAttributeNames = (surfaces: readonly SurfaceId[]): string[] =>
  surfaces.flatMap((surface) => surfaceOptionKeys(surface).map((key) => shapeAttributeName(surface, key)));
