/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import VoiceSettingsContent from '@/renderer/components/settings/SettingsModal/contents/voice/VoiceSettingsContent';
import { isElectronDesktop } from '@/renderer/utils/platform';
import SettingsPageWrapper from './components/SettingsPageWrapper';

const VoiceSettings: React.FC = () => {
  const { t } = useTranslation();

  // Reachable in a browser only by typing the URL — the navigation entry is
  // hidden there. It still has to say something true rather than render a page
  // of install buttons that answer to nothing: every channel behind them is
  // served by the Electron main process, which the WebUI host does not run.
  if (!isElectronDesktop()) {
    return (
      <SettingsPageWrapper>
        <div className='px-[12px] md:px-[32px] py-16px bg-2 rd-16px'>
          <p className='m-0 text-13px text-t-secondary'>{t('settings.voice.desktopOnly')}</p>
        </div>
      </SettingsPageWrapper>
    );
  }

  return (
    <SettingsPageWrapper>
      <VoiceSettingsContent />
    </SettingsPageWrapper>
  );
};

export default VoiceSettings;
