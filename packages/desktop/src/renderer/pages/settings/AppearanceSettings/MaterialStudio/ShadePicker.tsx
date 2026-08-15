/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import {
  ACCENT_SHADES,
  CARD_SHADES,
  GROUND_SHADES,
  INK_SHADES,
  type PaletteShades,
} from '@/common/theme/paletteShades';
import { resolvePalette, type SurfaceStyleChoice } from '@/common/theme/surfaceChoice';
import styles from './MaterialStudio.module.css';

/**
 * The four colours a palette derives, each nudged by name.
 *
 * The picker next door chooses one seed and everything else follows from it,
 * which is what keeps the interface readable whatever colour is picked — and is
 * also why there was no way to say "a bit darker" or "red text". The obvious
 * answer is four colour wheels and it is the wrong one: a wheel lets anybody
 * land on grey-on-grey, and the whole derivation exists to make that
 * impossible.
 *
 * So each slot offers a short list of named moves, every one of which is
 * re-measured against the ground before it is worn. What is on screen is the
 * real colour, from the same function that is about to paint the page, so a
 * swatch cannot promise something the application then does not do.
 */

export type ShadePickerProps = {
  choice: SurfaceStyleChoice;
  dark: boolean;
  onChange: <K extends keyof PaletteShades>(slot: K, value: PaletteShades[K] | undefined) => void;
};

/** Each slot, the moves it offers, and the colour it is showing right now. */
const SLOTS = [
  { slot: 'ground', options: GROUND_SHADES },
  { slot: 'card', options: CARD_SHADES },
  { slot: 'ink', options: INK_SHADES },
  { slot: 'accent', options: ACCENT_SHADES },
] as const;

const ShadePicker: React.FC<ShadePickerProps> = ({ choice, dark, onChange }) => {
  const { t } = useTranslation();
  const palette = resolvePalette(choice, dark);

  return (
    <div className='grid gap-12px' data-testid='shade-picker'>
      <Typography.Text className='text-12px text-t-tertiary'>{t('settings.material.shadesHint')}</Typography.Text>

      {SLOTS.map(({ slot, options }) => {
        const current = choice.shades?.[slot];

        return (
          <div key={slot} className='grid gap-6px'>
            <div className='flex items-center gap-8px'>
              {/* The colour this row is about, so the words have a referent. */}
              <i
                aria-hidden='true'
                className='size-14px shrink-0 rounded-4px border border-border-2'
                style={{ background: palette[slot] }}
              />
              <Typography.Text className='text-12px font-600 text-t-secondary'>
                {t(`settings.material.slot.${slot}`)}
              </Typography.Text>
            </div>

            <div className={styles.quick} role='radiogroup' aria-label={t(`settings.material.slot.${slot}`)}>
              {/* Putting it back is a choice like any other, and it is first
                  because it is the one somebody reaches for after trying the
                  rest. Stored as absent rather than as a value named
                  "default" — see `setShade`. */}
              <Button
                size='mini'
                shape='round'
                type={current === undefined ? 'primary' : 'default'}
                data-testid={`shade-${slot}-default`}
                onClick={() => onChange(slot, undefined)}
              >
                {t('settings.material.shadeDefault')}
              </Button>
              {options.map((option) => (
                <Button
                  key={option}
                  size='mini'
                  shape='round'
                  type={current === option ? 'primary' : 'default'}
                  data-testid={`shade-${slot}-${option}`}
                  onClick={() => onChange(slot, option as never)}
                >
                  {t(`settings.material.shade.${option}`)}
                </Button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ShadePicker;
