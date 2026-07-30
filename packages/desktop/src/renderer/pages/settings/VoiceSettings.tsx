/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import VoiceSettingsContent from '@/renderer/components/settings/SettingsModal/contents/voice/VoiceSettingsContent';
import SettingsPageWrapper from './components/SettingsPageWrapper';

const VoiceSettings: React.FC = () => {
  return (
    <SettingsPageWrapper>
      <VoiceSettingsContent />
    </SettingsPageWrapper>
  );
};

export default VoiceSettings;
