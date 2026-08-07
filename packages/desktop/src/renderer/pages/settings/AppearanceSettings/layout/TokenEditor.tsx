/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Slider, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { LAYOUT_TOKEN_KEYS, TOKEN_SPECS, type LayoutTokenKey, type LayoutTokens } from '@/common/config/layoutTokens';
import styles from './TokenEditor.module.css';

/**
 * The dials, and something to watch while you turn them.
 *
 * Sliders rather than a list of presets, because "make the corners a bit
 * rounder" is not a choice between two of somebody else's opinions — it is a
 * number, and the person turning it is the one who knows when it looks right.
 *
 * The preview is the point. A settings page that changes something you cannot
 * see from it is a page where you turn a knob, close it, look, come back and
 * turn it again; three of those and most people give up and keep the default.
 * So a real card, a real button and a real chip sit beside the controls, wearing
 * exactly what the sliders say.
 */

export type TokenEditorProps = {
  tokens: LayoutTokens;
  onChange: (tokens: LayoutTokens) => void;
};

/** The preview's own variables, so it wears the draft rather than the app's. */
const previewStyle = (tokens: LayoutTokens): React.CSSProperties =>
  ({
    '--preview-radius': `${tokens.radius}px`,
    '--preview-radius-sm': `${Math.round(tokens.radius * 0.5)}px`,
    '--preview-gap': `${Math.round(12 * tokens.spacing)}px`,
    '--preview-pad': `${Math.round(14 * tokens.spacing)}px`,
    '--preview-text': `${Math.round(13 * tokens.textScale)}px`,
    '--preview-motion': `${tokens.motionMs}ms`,
    '--preview-accent': String(tokens.accent),
    '--preview-contrast': String(tokens.contrast),
  }) as React.CSSProperties;

const TokenEditor: React.FC<TokenEditorProps> = ({ tokens, onChange }) => {
  const { t } = useTranslation();

  const set = (key: LayoutTokenKey, value: number): void => onChange({ ...tokens, [key]: value });

  /** The number as the user reads it, which is not always how it is stored. */
  const shown = (key: LayoutTokenKey): string => {
    const spec = TOKEN_SPECS[key];
    if (spec.unit === 'px') return `${tokens[key]}px`;
    if (spec.unit === 'ms') return tokens[key] === 0 ? t('settings.layout.token.instant') : `${tokens[key]}ms`;
    return `${Math.round(tokens[key] * 100)}%`;
  };

  return (
    <div className={styles.editor}>
      <div className={styles.dials}>
        {LAYOUT_TOKEN_KEYS.map((key) => (
          <label key={key} className={styles.dial}>
            <span className={styles.dialHead}>
              <Typography.Text className='text-12px font-600 text-t-secondary'>
                {t(`settings.layout.token.${key}`)}
              </Typography.Text>
              <span className={styles.value}>{shown(key)}</span>
            </span>
            <Slider
              data-testid={`token-${key}`}
              value={tokens[key]}
              min={TOKEN_SPECS[key].min}
              max={TOKEN_SPECS[key].max}
              step={TOKEN_SPECS[key].step}
              onChange={(value) => set(key, Array.isArray(value) ? value[0] : value)}
            />
            <Typography.Text className='text-11px leading-15px text-t-tertiary'>
              {t(`settings.layout.tokenHint.${key}`)}
            </Typography.Text>
          </label>
        ))}
      </div>

      {/* Not a picture of the app: real elements, wearing the draft. Anything
          less and the preview is a promise rather than an answer. */}
      <div className={styles.preview} style={previewStyle(tokens)} data-testid='token-preview'>
        <span className={styles.previewLabel}>{t('settings.layout.preview')}</span>
        <div className={styles.card}>
          <div className={styles.cardTitle}>{t('settings.layout.previewTitle')}</div>
          <div className={styles.cardBody}>{t('settings.layout.previewBody')}</div>
          <div className={styles.chips}>
            <span className={styles.chip}>{t('settings.layout.previewChip')}</span>
            <span className={styles.chipAccent}>{t('settings.layout.previewChipAccent')}</span>
          </div>
          <div className={styles.actions}>
            <button type='button' className={styles.buttonGhost}>
              {t('common.cancel')}
            </button>
            <button type='button' className={styles.buttonPrimary}>
              {t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TokenEditor;
