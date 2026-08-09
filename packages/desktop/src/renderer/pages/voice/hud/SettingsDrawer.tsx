/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';
import { Button } from '@arco-design/web-react';
import { Close, SettingTwo } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import styles from './VoiceHud.module.css';

/**
 * The settings, out of the way until they are wanted.
 *
 * They used to be a column that was always there, which is the wrong trade for a
 * surface you use by talking: the settings are changed between conversations and
 * the conversation is what you are here for, so the permanent thing was the one
 * that mattered least.
 *
 * Two behaviours that a `hidden` attribute does not give you and that this panel
 * is wrong without. It **scrolls its own body** — the controls are taller than a
 * short window and the last of them used to sit below the bottom edge with no
 * way to reach them. And it **closes on Escape and on the backdrop**, because a
 * panel that covers what you were looking at has to be dismissible without
 * hunting for the button that opened it.
 */

export type SettingsDrawerProps = {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  children: React.ReactNode;
};

const SettingsDrawer: React.FC<SettingsDrawerProps> = ({ open, onOpen, onClose, children }) => {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKeyDown);
    // Focus moves into the panel so the keyboard goes with the eye, and back to
    // the button that opened it when it closes.
    panelRef.current?.focus();

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      openerRef.current?.focus();
    };
  }, [open, onClose]);

  return (
    <>
      <Button
        ref={openerRef}
        className={styles.opener}
        type='text'
        size='small'
        icon={<SettingTwo size={15} />}
        data-testid='voice-settings-open'
        aria-expanded={open}
        onClick={onOpen}
      >
        {t('settings.voice.conversationSetup')}
      </Button>

      {/* Rendered whether open or not, so the controls inside keep their state
          across an open and close — a half-typed instruction must survive being
          interrupted by the conversation it was being written for. */}
      <div className={classNames(styles.drawer, open && styles.drawerOpen)} aria-hidden={!open}>
        <button
          type='button'
          className={styles.scrim}
          tabIndex={open ? 0 : -1}
          aria-label={t('common.close')}
          onClick={onClose}
        />
        <div
          ref={panelRef}
          className={`fool-surface ${styles.drawerPanel}`}
          role='dialog'
          aria-modal='false'
          aria-label={t('settings.voice.conversationSetup')}
          tabIndex={-1}
          data-testid='voice-settings-drawer'
        >
          <div className={styles.drawerHead}>
            <span>{t('settings.voice.conversationSetup')}</span>
            <Button
              type='text'
              size='mini'
              icon={<Close size={14} />}
              aria-label={t('common.close')}
              data-testid='voice-settings-close'
              onClick={onClose}
            />
          </div>
          {/* The scrolling body. Everything above and below it stays put, so the
              heading and the close button do not scroll away from the content
              they belong to. */}
          <div className={styles.drawerBody}>{children}</div>
        </div>
      </div>
    </>
  );
};

export default SettingsDrawer;
