/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import AppearanceModalContent from '@/renderer/components/settings/SettingsModal/contents/AppearanceModalContent';
import SettingsPageWrapper from '../components/SettingsPageWrapper';
import ThemeCustomizer from './ThemeCustomizer';

const AppearanceSettings: React.FC = () => {
  return (
    <SettingsPageWrapper>
      <AppearanceModalContent />
      {/* Sits under the theme pickers: overrides layer on the chosen preset. */}
      <div className='mt-24px pt-24px border-t border-fill-2'>
        <ThemeCustomizer />
      </div>
    </SettingsPageWrapper>
  );
};

export default AppearanceSettings;
