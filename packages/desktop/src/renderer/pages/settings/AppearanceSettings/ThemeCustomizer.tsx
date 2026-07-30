/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, ColorPicker, Slider } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { configService } from '@/common/config/configService';
import {
  THEME_COLOR_KEYS,
  THEME_OVERRIDES_CONFIG_KEY,
  RADIUS_SPEC,
  defaultThemeOverrides,
  isValidHexColor,
  sanitizeThemeOverrides,
  type ThemeColorKey,
  type ThemeOverrides,
} from '@/common/config/themeOverrides';
import { applyThemeOverrides } from '@/renderer/utils/theme/applyThemeOverrides';

/**
 * Live theme customisation layered over the selected preset.
 *
 * Every change is applied to the root CSS variables as it happens, so the whole
 * window updates while the picker is still open; persistence follows after.
 */
const ThemeCustomizer: React.FC = () => {
  const { t } = useTranslation();
  const [overrides, setOverrides] = useState<ThemeOverrides>(defaultThemeOverrides);

  useEffect(() => {
    const restored = sanitizeThemeOverrides(configService.get(THEME_OVERRIDES_CONFIG_KEY));
    setOverrides(restored);
    applyThemeOverrides(restored);
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
              value={overrides.colors[key]}
              data-testid={`theme-color-${key}`}
              onChange={(value) => handleColor(key, String(value))}
            />
          </label>
        ))}
      </div>

      <label className='flex flex-col gap-4px'>
        <span className='text-13px text-t-secondary'>
          {t('settings.themeCustomizer.cornerRadius')} — {overrides.radiusPx}px
        </span>
        <Slider
          min={RADIUS_SPEC.min}
          max={RADIUS_SPEC.max}
          value={overrides.radiusPx}
          data-testid='theme-radius'
          onChange={(value) => commit({ ...overrides, radiusPx: Array.isArray(value) ? value[0] : value })}
        />
      </label>
    </section>
  );
};

export default ThemeCustomizer;
