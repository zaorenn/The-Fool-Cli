/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback } from 'react';
import { Button, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { SURFACE_STYLES, isDark, type MaterialTokenKey, type SurfaceStyleId } from '@/common/theme/surfaceStyle';
import type { SurfaceStyleChoice } from '@/common/theme/surfaceChoice';
import { applySurfaceChoice, useSurfaceStyle } from '@renderer/hooks/config/useSurfaceStyle';
import AccentPicker from './AccentPicker';
import BackgroundPicker from './BackgroundPicker';
import DialGroups from './DialGroups';
import MaterialCards from './MaterialCards';
import { offeredDials, type DialKey } from './dials';
import styles from './MaterialStudio.module.css';

/**
 * What the application is made of, as a thing you can choose.
 *
 * Sits beside the theme pickers rather than replacing them, because it answers
 * a question they do not: a theme decides the colours, a layout decides the
 * arrangement, and this decides the material — whether a card is raised out of
 * the ground, or a pane of glass with a lit world behind it, or paper with a
 * hard shadow. All three are real questions and one control answering all of
 * them would mean taking a look nobody wanted to get a feel they did.
 *
 * Everything is applied as it is touched, on the whole window, on purpose. A
 * preview inside a panel can only ever show a card and a button; what somebody
 * is actually deciding is whether their sidebar, their conversation and their
 * voice notch look right, and none of those fit in a box on a settings page.
 * Reset is one click, so the cost of trying the wrong one is a click.
 */

const MaterialStudio: React.FC = () => {
  const { t } = useTranslation();
  const { choice, tokens, setStyle, setAccent, setToken, reset } = useSurfaceStyle();

  const prefersDark = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark';
  const dark = isDark(choice.style, prefersDark);

  const valueOf = useCallback((key: DialKey): number => tokens[key as MaterialTokenKey], [tokens]);

  /**
   * Shown now, kept later.
   *
   * A slider fires on every pixel of a drag. Writing each of those through the
   * store would be a few hundred round trips to settle one shadow, and reading
   * each of them back would fight the thumb the user is still holding. So the
   * moving value goes straight onto the document and nowhere else; the value
   * they let go of is the one that gets stored.
   */
  const move = useCallback(
    (key: DialKey, value: number): void => {
      const next: SurfaceStyleChoice = { ...choice, tokens: { ...choice.tokens, [key]: value } };
      applySurfaceChoice(next);
    },
    [choice]
  );

  const settle = useCallback(
    (key: DialKey, value: number): void => {
      void setToken(key as MaterialTokenKey, value);
    },
    [setToken]
  );

  return (
    <section className='grid gap-16px' data-testid='material-studio'>
      <header className='flex items-start justify-between gap-12px'>
        <div className='grid gap-4px'>
          <Typography.Title heading={6} className='!mb-0 !text-t-primary'>
            {t('settings.material.title')}
          </Typography.Title>
          <Typography.Text className='text-12px leading-19px text-t-tertiary'>
            {t('settings.material.subtitle')}
          </Typography.Text>
        </div>
        <Button size='mini' data-testid='material-reset' onClick={() => void reset()}>
          {t('settings.material.reset')}
        </Button>
      </header>

      <MaterialCards chosen={choice.style} onChoose={(style: SurfaceStyleId) => void setStyle(style)} />

      <AccentPicker
        accent={choice.accent}
        style={choice.style}
        dark={dark}
        tint={tokens.tint}
        onChange={(accent) => void setAccent(accent)}
      />

      {/* Under the colour, because it answers the same question with a picture
          instead of a swatch — and choosing one answers the colour too. */}
      <BackgroundPicker accent={choice.accent} onAccent={(hex) => void setAccent(hex)} />

      {/* Real elements wearing the real thing, for the part of the application
          that is not on screen while somebody is on this page. */}
      <div className={`fool-page ${styles.preview}`} data-testid='material-preview'>
        <div className={`fool-surface ${styles.previewCard}`}>
          <span className='fool-heading text-14px'>{t('settings.material.previewTitle')}</span>
          <span className='fool-body fool-muted text-12px'>{t('settings.material.previewBody')}</span>
        </div>
        <div className={styles.previewRow}>
          <Button type='primary' size='small'>
            {t('common.save')}
          </Button>
          <Button size='small'>{t('common.cancel')}</Button>
        </div>
      </div>

      {/* Only the dials this material can feel — and no colour dials at all.
          Hue, vividness, brightness and the grey tint used to sit here, and
          every one of them could walk a chosen palette out of the contrast the
          palette was chosen for. Shape is safe to hand over: no radius, shadow
          or spacing can make text unreadable. Colour is not, so the choice is
          the palette and the rest is derived. */}
      <DialGroups available={offeredDials(choice.style)} value={valueOf} onMove={move} onSettle={settle} />
    </section>
  );
};

export default MaterialStudio;
