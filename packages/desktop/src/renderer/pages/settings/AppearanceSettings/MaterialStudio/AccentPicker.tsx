/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button, ColorPicker, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ACCENT_SUGGESTIONS, paletteRamp, sanitizeAccent, type SurfaceStyleId } from '@/common/theme/surfaceStyle';
import styles from './MaterialStudio.module.css';

/**
 * One colour in, a whole application out.
 *
 * The ramp beside the picker is the point of it. A hex value tells somebody
 * nothing about whether their application will still be readable; five bands —
 * accent, its lighter partner, the card, the ground, the ink — tell them at a
 * glance, and they are the real colours, derived by the same function the page
 * is about to be painted with rather than by an approximation drawn for the
 * settings screen.
 */

export type AccentPickerProps = {
  accent: string;
  style: SurfaceStyleId;
  dark: boolean;
  tint: number;
  onChange: (accent: string) => void;
};

const AccentPicker: React.FC<AccentPickerProps> = ({ accent, style, dark, tint, onChange }) => {
  const { t } = useTranslation();
  const ramp = paletteRamp(accent, style, dark, tint);

  return (
    <div className='grid gap-9px'>
      <div className='flex items-center gap-10px'>
        <ColorPicker
          disabledAlpha
          value={accent}
          onChange={(value) => onChange(sanitizeAccent(String(value)))}
          triggerProps={{ 'aria-label': t('settings.material.accent') } as Record<string, unknown>}
        />
        <span className={styles.ramp} data-testid='accent-ramp' aria-hidden='true'>
          {ramp.map((band, index) => (
            <i key={`${band}-${index}`} className={styles.band} style={{ background: band }} />
          ))}
        </span>
      </div>

      <div className={styles.quick} role='group' aria-label={t('settings.material.accentSuggestions')}>
        {ACCENT_SUGGESTIONS.map((hex) => (
          <Button
            key={hex}
            data-testid={`accent-${hex.slice(1)}`}
            className={`${styles.dot} ${hex === accent ? styles.chosen : ''}`}
            style={{ background: hex }}
            aria-label={hex}
            aria-pressed={hex === accent}
            onClick={() => onChange(hex)}
          />
        ))}
      </div>

      <Typography.Text className='text-11px leading-16px text-t-tertiary'>
        {t('settings.material.accentHint')}
      </Typography.Text>
    </div>
  );
};

export default AccentPicker;
