/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { SURFACE_STYLE_IDS, type SurfaceStyleId } from '@/common/theme/surfaceStyle';
import styles from './MaterialStudio.module.css';

/**
 * Seven materials, each drawn in its own material.
 *
 * The swatch is the explanation. "Neumorphism" and "brutalism" are words from
 * somebody else's argument about design, and a person who has never read that
 * argument still knows immediately which of these seven they want — but only if
 * they can see them. A list of seven names with a radio beside each would be a
 * setting nobody touches.
 */

const SWATCH: Record<SurfaceStyleId, string> = {
  neu: styles.neu,
  glass: styles.glass,
  liquid: styles.liquid,
  clay: styles.clay,
  aurora: styles.aurora,
  brutal: styles.brutal,
  minimal: styles.minimal,
};

export type MaterialCardsProps = {
  chosen: SurfaceStyleId;
  onChoose: (style: SurfaceStyleId) => void;
};

const MaterialCards: React.FC<MaterialCardsProps> = ({ chosen, onChoose }) => {
  const { t } = useTranslation();

  return (
    <div className={styles.cards} role='group' aria-label={t('settings.material.materialLabel')}>
      {SURFACE_STYLE_IDS.map((id) => (
        <Button
          key={id}
          data-testid={`material-${id}`}
          className={styles.card}
          type={id === chosen ? 'primary' : 'default'}
          aria-pressed={id === chosen}
          onClick={() => onChoose(id)}
        >
          <span className={`${styles.swatch} ${SWATCH[id]}`} aria-hidden='true' />
          <Typography.Text className='text-11px font-600'>{t(`settings.appearance.material.${id}`)}</Typography.Text>
        </Button>
      ))}
    </div>
  );
};

export default MaterialCards;
