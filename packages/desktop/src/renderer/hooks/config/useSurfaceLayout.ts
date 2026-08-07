/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { configService } from '@/common/config/configService';
import { defaultLayoutTokens, sanitizeLayoutTokens, type LayoutTokens } from '@/common/config/layoutTokens';
import { applyLayoutTokens } from '@renderer/utils/theme/applyLayoutTokens';
import {
  LAYOUT_PRESETS_CONFIG_KEY,
  MAX_LAYOUT_PRESETS,
  normalizeLayoutName,
  resolveLayout,
  sanitizeLayoutOptions,
  sanitizeLayoutPresets,
  sanitizeSurfaceLayouts,
  SURFACE_LAYOUT_CONFIG_KEY,
  type LayoutOptions,
  type LayoutPreset,
  type LayoutPresetLibrary,
  type SurfaceId,
} from '@/common/config/surfaceLayouts';

/**
 * What shape a surface is wearing, and how to change it.
 *
 * Built on `configService` rather than on a store of its own, which is the same
 * place themes live: it is already the backend's client preferences, already
 * cached synchronously so a first render has an answer, and already told when
 * another window changes something. A second mechanism beside it would be a
 * second place for the same setting to be wrong.
 */

/** Reads the current shape without a subscription, for code outside React. */
export const peekSurfaceLayout = (surface: SurfaceId): LayoutPreset =>
  resolveLayout(
    surface,
    sanitizeSurfaceLayouts(configService.get(SURFACE_LAYOUT_CONFIG_KEY)),
    sanitizeLayoutPresets(configService.get(LAYOUT_PRESETS_CONFIG_KEY))
  );

/** Every shape this surface can wear, built-ins first, as stored right now. */
export const peekLayoutPresets = (): LayoutPresetLibrary =>
  sanitizeLayoutPresets(configService.get(LAYOUT_PRESETS_CONFIG_KEY));

/** Puts a layout on a surface, leaving every other surface alone. */
export const wearLayout = async (surface: SurfaceId, layoutId: string): Promise<void> => {
  const selection = sanitizeSurfaceLayouts(configService.get(SURFACE_LAYOUT_CONFIG_KEY));
  await configService.set(SURFACE_LAYOUT_CONFIG_KEY, { ...selection, [surface]: normalizeLayoutName(layoutId) });
  // The dials go on with the shape. They are part of the layout rather than a
  // setting beside it, so a layout that is worn and does not bring its own
  // corners with it would be half a layout.
  applyLayoutTokens(peekSurfaceLayout(surface).tokens);
};

/**
 * Keeps the current shape under a name the user chose, and wears it.
 *
 * Saving and wearing together because they are one intent: someone who has just
 * adjusted a layout and named it means "this one, from now on". A save that left
 * the surface on what it had would look like the save failing.
 */
export const saveLayoutPreset = async (
  surface: SurfaceId,
  name: string,
  options: LayoutOptions,
  tokens: LayoutTokens = defaultLayoutTokens()
): Promise<LayoutPreset | null> => {
  const id = normalizeLayoutName(name);
  if (id.length === 0) return null;

  const presets = sanitizeLayoutPresets(configService.get(LAYOUT_PRESETS_CONFIG_KEY));
  const preset: LayoutPreset = {
    id,
    name: name.trim().slice(0, 48),
    surface,
    builtin: false,
    options: sanitizeLayoutOptions(options, surface),
    tokens: sanitizeLayoutTokens(tokens),
  };

  // Oldest first, so a library built up out loud never grows without bound.
  const kept = Object.entries(presets)
    .filter(([key]) => key !== id)
    .slice(-(MAX_LAYOUT_PRESETS - 1));

  await configService.set(LAYOUT_PRESETS_CONFIG_KEY, Object.fromEntries([...kept, [id, preset]]));
  await wearLayout(surface, id);
  return preset;
};

/** Drops one the user made. A built-in is not theirs to delete and is refused. */
export const deleteLayoutPreset = async (surface: SurfaceId, name: string): Promise<boolean> => {
  const id = normalizeLayoutName(name);
  const presets = sanitizeLayoutPresets(configService.get(LAYOUT_PRESETS_CONFIG_KEY));
  if (!presets[id]) return false;

  const { [id]: _removed, ...rest } = presets;
  await configService.set(LAYOUT_PRESETS_CONFIG_KEY, rest);

  // A surface left wearing something that no longer exists resolves back to its
  // default on the next read, but doing it here means the change is visible now
  // rather than on the next launch.
  const selection = sanitizeSurfaceLayouts(configService.get(SURFACE_LAYOUT_CONFIG_KEY));
  if (selection[surface] === id) await wearLayout(surface, 'instrument');
  return true;
};

export type SurfaceLayoutHandle = {
  layout: LayoutPreset;
  presets: LayoutPresetLibrary;
  wear: (layoutId: string) => Promise<void>;
  save: (name: string, options: LayoutOptions, tokens?: LayoutTokens) => Promise<LayoutPreset | null>;
  remove: (name: string) => Promise<boolean>;
};

export const useSurfaceLayout = (surface: SurfaceId): SurfaceLayoutHandle => {
  const [layout, setLayout] = useState<LayoutPreset>(() => peekSurfaceLayout(surface));
  const [presets, setPresets] = useState<LayoutPresetLibrary>(() => peekLayoutPresets());

  useEffect(() => {
    const read = (): void => {
      const worn = peekSurfaceLayout(surface);
      setLayout(worn);
      setPresets(peekLayoutPresets());
      // Also when the change came from somewhere else — another window, or a
      // workspace being switched — so the corners follow the shape wherever the
      // decision was made.
      applyLayoutTokens(worn.tokens);
    };

    read();
    // Both keys, because a preset edited elsewhere changes what the selection
    // resolves to even though the selection itself did not move.
    const offSelection = configService.subscribe(SURFACE_LAYOUT_CONFIG_KEY, read);
    const offPresets = configService.subscribe(LAYOUT_PRESETS_CONFIG_KEY, read);

    return () => {
      offSelection();
      offPresets();
    };
  }, [surface]);

  return {
    layout,
    presets,
    wear: useCallback((layoutId: string) => wearLayout(surface, layoutId), [surface]),
    save: useCallback(
      (name: string, options: LayoutOptions, tokens?: LayoutTokens) => saveLayoutPreset(surface, name, options, tokens),
      [surface]
    ),
    remove: useCallback((name: string) => deleteLayoutPreset(surface, name), [surface]),
  };
};
