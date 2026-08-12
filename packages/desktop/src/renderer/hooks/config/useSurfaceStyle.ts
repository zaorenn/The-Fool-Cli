/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the application is made of, and how it is put on.
 *
 * Built on `configService` for the same reason the layouts are: it is already
 * the client's preferences, already cached so a first render has an answer, and
 * already tells the other windows when something changes. A second mechanism
 * beside it would be a second place for the same setting to be wrong — and this
 * setting has three callers, not one: the panel, the first-run wizard, and an
 * agent asked out loud to make the interface warmer.
 */

import { useCallback, useEffect, useState } from 'react';
import { configService } from '@/common/config/configService';
import {
  defaultSurfaceChoice,
  resolveTokens,
  sanitizeSurfaceChoice,
  surfaceChoiceVariables,
  type SurfaceStyleChoice,
} from '@/common/theme/surfaceChoice';
import { materialStylesheet } from '@/common/theme/materialStylesheet';
import { restackThemeStyles } from '@renderer/utils/theme/applyThemeOverrides';
import {
  SURFACE_BACKGROUND_CONFIG_KEY,
  sanitizeSurfaceBackground,
  type SurfaceBackground,
} from '@/common/theme/surfaceBackground';
import { SURFACE_STYLES, type MaterialTokens, type SurfaceStyleId } from '@/common/theme/surfaceStyle';

export const SURFACE_STYLE_CONFIG_KEY = 'ui.surfaceStyle' as const;

/** What is stored right now, repaired. */
export const peekSurfaceChoice = (): SurfaceStyleChoice =>
  sanitizeSurfaceChoice(configService.get(SURFACE_STYLE_CONFIG_KEY));

/** The picture behind it, repaired. */
export const peekSurfaceBackground = (): SurfaceBackground =>
  sanitizeSurfaceBackground(configService.get(SURFACE_BACKGROUND_CONFIG_KEY));

/** Whether the room is dark, as the document already knows it. */
const prefersDark = (): boolean => document.documentElement.getAttribute('data-theme') === 'dark';

/** The stylesheet the material writes into the application's own tokens. */
const MATERIAL_STYLE_ID = 'fool-material';

/**
 * Puts the generated sheet in the head, in its place.
 *
 * Everything here is `!important`, and so is the theme preset underneath and the
 * colours the user picked on top, so between them the cascade decides on source
 * order alone. This used to append itself last and win — including over a colour
 * somebody had chosen by hand, which is how a saved colour stopped surviving a
 * restart. The order now belongs to `restackThemeStyles`, which puts the
 * material above the palette and below the dials.
 */
const publish = (css: string): void => {
  const existing = document.getElementById(MATERIAL_STYLE_ID) as HTMLStyleElement | null;
  const element = existing ?? document.createElement('style');
  element.id = MATERIAL_STYLE_ID;
  element.textContent = css;
  if (!element.isConnected) document.head.appendChild(element);
  restackThemeStyles();
};

/**
 * Writes a choice onto a document.
 *
 * Two halves, and the second is the one that matters. The inline variables are
 * what `materials.css` reads; the stylesheet is what the rest of the
 * application reads, because almost nothing on screen is an element somebody
 * can add a class to — it is Arco's components and a hundred utility classes
 * pointing at the app's own tokens. Writing only the first half is how this
 * layer spent its first version changing six boxes and nothing else.
 *
 * A `target` other than the document gets the variables alone: an element
 * preview cannot own a document-wide stylesheet, and does not need one.
 */
export const applySurfaceChoice = (
  choice: SurfaceStyleChoice,
  target: HTMLElement = document.documentElement
): void => {
  const dark = prefersDark();
  for (const [name, value] of surfaceChoiceVariables(choice, dark)) {
    target.style.setProperty(name, value);
  }
  if (target === document.documentElement) publish(materialStylesheet(choice, dark, peekSurfaceBackground()));
  // The attribute is what `materials.css` selects on. Set last, so a page never
  // renders a material against the variables of the one before it.
  target.setAttribute('data-fool-style', choice.style);
};

/** Takes it all off again, leaving the application drawing what it always drew. */
export const clearSurfaceChoice = (target: HTMLElement = document.documentElement): void => {
  for (const [name] of surfaceChoiceVariables(defaultSurfaceChoice(), false)) {
    target.style.removeProperty(name);
  }
  if (target === document.documentElement) document.getElementById(MATERIAL_STYLE_ID)?.remove();
  target.removeAttribute('data-fool-style');
};

/**
 * Wears whatever is stored, and keeps wearing it.
 *
 * Mounted once at the app root. Without this the material was a setting three
 * callers could write and nothing could read: the panel, the wizard and the
 * spoken tool all put a choice in `configService`, and the page went on drawing
 * what it always drew. The first paint is not this hook's job — that happens in
 * `bootstrapRendererConfig`, before React exists, for the same reason the saved
 * colours are applied there. This is what happens afterwards: another window
 * changing the choice, and the light/dark switch moving, which changes what the
 * same choice derives to.
 *
 * Deliberately returns nothing. A root component re-rendering every time a dial
 * moves would re-render the whole application to change a shadow.
 */
export const useWornSurfaceStyle = (): void => {
  useEffect(() => {
    const wear = (): void => applySurfaceChoice(peekSurfaceChoice());
    wear();
    const stop = configService.subscribe(SURFACE_STYLE_CONFIG_KEY, wear);
    // The picture is stored apart from the material and changes without it.
    const stopBackground = configService.subscribe(SURFACE_BACKGROUND_CONFIG_KEY, wear);
    const observer = new MutationObserver(wear);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      stop();
      stopBackground();
      observer.disconnect();
    };
  }, []);
};

/**
 * The choice, applied, and kept applied.
 *
 * Re-applies when another window changes it and when the light/dark switch
 * moves, because half of what is derived here depends on which of those is on.
 */
export const useSurfaceStyle = (): {
  choice: SurfaceStyleChoice;
  tokens: MaterialTokens;
  setStyle: (style: SurfaceStyleId) => Promise<void>;
  setAccent: (accent: string) => Promise<void>;
  setToken: (key: keyof MaterialTokens, value: number) => Promise<void>;
  reset: () => Promise<void>;
} => {
  const [choice, setChoice] = useState<SurfaceStyleChoice>(peekSurfaceChoice);

  useEffect(() => {
    applySurfaceChoice(choice);
  }, [choice]);

  useEffect(() => {
    const stop = configService.subscribe(SURFACE_STYLE_CONFIG_KEY, () => setChoice(peekSurfaceChoice()));
    // The light/dark switch changes what the palette derives to, so the same
    // choice has to be recomputed rather than left as it was.
    const observer = new MutationObserver(() => applySurfaceChoice(peekSurfaceChoice()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      stop();
      observer.disconnect();
    };
  }, []);

  const write = useCallback(async (next: SurfaceStyleChoice): Promise<void> => {
    const repaired = sanitizeSurfaceChoice(next);
    setChoice(repaired);
    await configService.set(SURFACE_STYLE_CONFIG_KEY, repaired);
  }, []);

  return {
    choice,
    tokens: resolveTokens(choice),
    /**
     * Choosing a material drops the dials that were moved for the last one.
     *
     * The alternative — carrying them over — is how somebody who nudged the
     * shadow on the raised material ends up with glass that has a shadow
     * nobody asked for, and no way to tell where it came from.
     */
    setStyle: (style: SurfaceStyleId) => write({ style, accent: choice.accent }),
    setAccent: (accent: string) => write({ ...choice, accent }),
    setToken: (key: keyof MaterialTokens, value: number) =>
      write({ ...choice, tokens: { ...choice.tokens, [key]: value } }),
    reset: () => write(defaultSurfaceChoice()),
  };
};

/** Every material, for a picker to show. */
export const surfaceStyleList = (): readonly SurfaceStyleId[] =>
  (Object.keys(SURFACE_STYLES) as SurfaceStyleId[]).slice();
