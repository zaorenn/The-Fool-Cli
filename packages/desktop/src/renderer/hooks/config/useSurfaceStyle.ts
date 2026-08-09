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
import { SURFACE_STYLES, isDark, type MaterialTokens, type SurfaceStyleId } from '@/common/theme/surfaceStyle';

export const SURFACE_STYLE_CONFIG_KEY = 'ui.surfaceStyle' as const;

/** What is stored right now, repaired. */
export const peekSurfaceChoice = (): SurfaceStyleChoice =>
  sanitizeSurfaceChoice(configService.get(SURFACE_STYLE_CONFIG_KEY));

/** Whether the room is dark, as the document already knows it. */
const prefersDark = (): boolean => document.documentElement.getAttribute('data-theme') === 'dark';

/**
 * Writes a choice onto a document.
 *
 * Exported so the settings panel can preview onto its own element without the
 * rest of the application changing under the user while they are deciding.
 */
export const applySurfaceChoice = (
  choice: SurfaceStyleChoice,
  target: HTMLElement = document.documentElement
): void => {
  const dark = isDark(choice.style, prefersDark());
  for (const [name, value] of surfaceChoiceVariables(choice, dark)) {
    target.style.setProperty(name, value);
  }
  // The attribute is what `materials.css` selects on. Set last, so a page never
  // renders a material against the variables of the one before it.
  target.setAttribute('data-fool-style', choice.style);
};

/** Takes it all off again, leaving the application drawing what it always drew. */
export const clearSurfaceChoice = (target: HTMLElement = document.documentElement): void => {
  for (const [name] of surfaceChoiceVariables(defaultSurfaceChoice(), false)) {
    target.style.removeProperty(name);
  }
  target.removeAttribute('data-fool-style');
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
      write({ ...choice, tokens: { ...(choice.tokens ?? {}), [key]: value } }),
    reset: () => write(defaultSurfaceChoice()),
  };
};

/** Every material, for a picker to show. */
export const surfaceStyleList = (): readonly SurfaceStyleId[] =>
  (Object.keys(SURFACE_STYLES) as SurfaceStyleId[]).slice();
