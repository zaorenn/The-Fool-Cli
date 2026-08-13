/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { PALETTES, nearestPalette } from '@/common/theme/palettes';
import { paletteRamp, type SurfaceStyleId } from '@/common/theme/surfaceStyle';
import styles from './MaterialStudio.module.css';

/**
 * One colour in, a whole application out — chosen from a list rather than a wheel.
 *
 * There was a colour picker here. A wheel is the right control for somebody who
 * knows exactly what they want and the wrong one for everybody else, because a
 * hex value carries no promise that the application will still be readable
 * afterwards: an accent picked freely is how a 2.41:1 button label shipped, and
 * how "some colours make things invisible" became something a user had to
 * notice and report.
 *
 * These nine are checked — all 126 combinations of palette, material and
 * appearance are asserted at 4.5:1 in `paletteContrast.test.ts`, and the worst
 * of them is 4.51:1. That is a promise no arbitrary point on a wheel can make.
 *
 * The ramp beside the choice is still the point of the control. Five bands —
 * accent, its lighter partner, the card, the ground, the ink — say at a glance
 * what the application will look like, and they are the real colours, derived
 * by the same function that is about to paint the page.
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
  // A colour stored before this list existed still has to highlight something.
  const chosen = PALETTES.find((palette) => palette.seed === accent) ?? nearestPalette(accent);

  return (
    <div className='grid gap-9px'>
      <span className={styles.ramp} data-testid='accent-ramp' aria-hidden='true'>
        {ramp.map((band, index) => (
          <i key={`${band}-${index}`} className={styles.band} style={{ background: band }} />
        ))}
      </span>

      <div className={styles.quick} role='radiogroup' aria-label={t('settings.material.accent')}>
        {PALETTES.map((palette) => (
          <Button
            key={palette.id}
            data-testid={`palette-${palette.id}`}
            className={`${styles.dot} ${palette.id === chosen.id ? styles.chosen : ''}`}
            style={{ background: palette.seed }}
            role='radio'
            aria-label={t(palette.name as 'settings.palette.ember')}
            aria-checked={palette.id === chosen.id}
            onClick={() => onChange(palette.seed)}
          />
        ))}
      </div>

      <Typography.Text className='text-11px leading-16px text-t-tertiary'>
        {t(chosen.name as 'settings.palette.ember')} · {t('settings.material.accentHint')}
      </Typography.Text>
    </div>
  );
};

export default AccentPicker;
