/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Close } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import WebviewHost from '@/renderer/components/media/WebviewHost';
import { BROWSER_HOME_URL, BROWSER_PARTITION } from '@/common/browser/browserSession';

export type BrowserPanelProps = {
  open: boolean;
  onClose: () => void;
};

/**
 * The in-app browser, which belongs to the user.
 *
 * Stays mounted once opened and is hidden with CSS rather than unmounted:
 * closing the panel should put the page away, not discard what the user was
 * reading and log them back out of it.
 *
 * This panel used to be the thing an agent drove, and it is not any more. Two
 * problems came with that arrangement: with the panel closed — which is most
 * sessions — every browser command was answered with "ask the user to open
 * it", so nothing could be looked up in the background; and with it open, an
 * agent following a chain of pages navigated away from whatever the user was
 * reading. The agent has its own offscreen page now (`process/browser/agentPage`)
 * on this same `persist:` partition, so it still has their logins and no longer
 * has their window.
 */
const BrowserPanel: React.FC<BrowserPanelProps> = ({ open, onClose }) => {
  const { t } = useTranslation();
  const [everOpened, setEverOpened] = useState(false);

  if (open && !everOpened) setEverOpened(true);
  if (!everOpened) return null;

  return (
    <div
      className='flex flex-col h-full w-full overflow-hidden bg-1'
      style={{ display: open ? 'flex' : 'none' }}
      role='region'
      aria-label={t('common.browser.title')}
      aria-hidden={!open}
    >
      <div className='flex items-center justify-between px-12px py-8px border-b border-[var(--border-base)] flex-shrink-0'>
        <span className='text-13px text-t-secondary'>{t('common.browser.isolatedHint')}</span>
        <button
          type='button'
          className='app-titlebar__button'
          onClick={onClose}
          aria-label={t('common.browser.close')}
          title={t('common.browser.close')}
        >
          <Close theme='outline' size={16} fill='currentColor' />
        </button>
      </div>
      <div className='flex-1 min-h-0'>
        <WebviewHost
          url={BROWSER_HOME_URL}
          showNavBar
          partition={BROWSER_PARTITION}
          className='h-full'
          onDidFailLoad={(_code, description) => {
            console.warn('[browser] navigation failed:', description);
          }}
        />
      </div>
    </div>
  );
};

export default BrowserPanel;
