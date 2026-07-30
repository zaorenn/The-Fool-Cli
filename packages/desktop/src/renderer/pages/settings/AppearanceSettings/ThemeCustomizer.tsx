/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, ColorPicker } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { configService } from '@/common/config/configService';
import {
  THEME_COLOR_KEYS,
  THEME_OVERRIDES_CONFIG_KEY,
  defaultThemeOverrides,
  isValidHexColor,
  sanitizeThemeOverrides,
  type ThemeColorKey,
  type ThemeOverrides,
} from '@/common/config/themeOverrides';
import { THEME_COLOR_SPECS } from '@/common/config/themeOverrides';
import { applyThemeOverrides } from '@/renderer/utils/theme/applyThemeOverrides';

/** `rgb(18, 21, 26)` -> `#12151a`; passes through values already in hex. */
const toHex = (value: string): string | null => {
  const trimmed = value.trim();
  if (isValidHexColor(trimmed)) return trimmed.toLowerCase();

  const match = trimmed.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
  if (!match) return null;

  const channels = match.slice(1, 4).map((part) => Number(part));
  if (channels.some((channel) => channel < 0 || channel > 255)) return null;

  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
};

/** Reads what the active preset resolves each themed variable to right now. */
const readActiveThemeColors = (): Partial<Record<ThemeColorKey, string>> => {
  const computed = getComputedStyle(document.documentElement);
  const colors: Partial<Record<ThemeColorKey, string>> = {};

  for (const key of THEME_COLOR_KEYS) {
    const hex = toHex(computed.getPropertyValue(THEME_COLOR_SPECS[key].cssVar));
    if (hex) colors[key] = hex;
  }
  return colors;
};

/**
 * Live theme customisation layered over the selected preset.
 *
 * Every change is applied to the root CSS variables as it happens, so the whole
 * window updates while the picker is still open; persistence follows after.
 */
const ThemeCustomizer: React.FC = () => {
  const { t } = useTranslation();
  const [overrides, setOverrides] = useState<ThemeOverrides>(defaultThemeOverrides);

  /** Colours the active preset is currently painting with. */
  const [presetColors, setPresetColors] = useState<Partial<Record<ThemeColorKey, string>>>({});

  useEffect(() => {
    const restored = sanitizeThemeOverrides(configService.get(THEME_OVERRIDES_CONFIG_KEY));
    setOverrides(restored);
    applyThemeOverrides(restored);

    // Seed each swatch from what the theme actually renders, so the picker
    // opens on the real colour instead of an empty value.
    setPresetColors(readActiveThemeColors());
  }, []);

  /** Applies immediately, then persists — the preview must never lag the input. */
  const commit = useCallback((next: ThemeOverrides) => {
    const clean = sanitizeThemeOverrides(next);
    setOverrides(clean);
    applyThemeOverrides(clean);
    void configService.set(THEME_OVERRIDES_CONFIG_KEY, clean).catch((): void => {
      // A failed write must not undo what the user already sees.
    });
  }, []);

  const handleColor = useCallback(
    (key: ThemeColorKey, value: string) => {
      if (!isValidHexColor(value)) return;
      commit({ ...overrides, colors: { ...overrides.colors, [key]: value } });
    },
    [commit, overrides]
  );

  const handleReset = useCallback(() => commit(defaultThemeOverrides()), [commit]);

  return (
    <section className='flex flex-col gap-16px' data-testid='theme-customizer'>
      <header className='flex items-center justify-between'>
        <h3 className='text-14px font-500 text-t-primary'>{t('settings.themeCustomizer.title')}</h3>
        <Button size='mini' onClick={handleReset} data-testid='theme-customizer-reset'>
          {t('settings.themeCustomizer.reset')}
        </Button>
      </header>

      <div className='flex flex-col gap-12px'>
        {THEME_COLOR_KEYS.map((key) => (
          <label key={key} className='flex items-center justify-between gap-12px'>
            <span className='text-13px text-t-secondary'>{t(`settings.themeCustomizer.${key}`)}</span>
            <ColorPicker
              showText
              disabledAlpha
              value={overrides.colors[key] ?? presetColors[key]}
              data-testid={`theme-color-${key}`}
              onChange={(value) => handleColor(key, String(value))}
            />
          </label>
        ))}
      </div>
    </section>
  );
};

export default ThemeCustomizer;
