/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import AppearanceModalContent from '@/renderer/components/settings/SettingsModal/contents/AppearanceModalContent';
import SettingsPageWrapper from '../components/SettingsPageWrapper';
import LayoutCustomizer from './LayoutCustomizer';
import ThemeCustomizer from './ThemeCustomizer';

const AppearanceSettings: React.FC = () => {
  return (
    <SettingsPageWrapper>
      <AppearanceModalContent />
      {/* Sits under the theme pickers: overrides layer on the chosen preset. */}
      <div className='mt-24px pt-24px border-t border-fill-2'>
        <ThemeCustomizer />
      </div>
      {/* And under those, the neighbouring question: colour is what the app
          looks like everywhere, layout is what one window is shaped like. */}
      <div className='mt-24px pt-24px border-t border-fill-2'>
        <LayoutCustomizer />
      </div>
    </SettingsPageWrapper>
  );
};

export default AppearanceSettings;
