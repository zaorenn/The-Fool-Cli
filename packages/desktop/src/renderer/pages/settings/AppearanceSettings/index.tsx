/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import AppearanceModalContent from '@/renderer/components/settings/SettingsModal/contents/AppearanceModalContent';
import SettingsPageWrapper from '../components/SettingsPageWrapper';
import LayoutCustomizer from './layout/LayoutCustomizer';
import MaterialStudio from './MaterialStudio';
import ThemeCustomizer from './ThemeCustomizer';

const AppearanceSettings: React.FC = () => {
  return (
    <SettingsPageWrapper>
      <AppearanceModalContent />
      {/* Sits under the theme pickers: overrides layer on the chosen preset. */}
      <div className='mt-24px pt-24px border-t border-fill-2'>
        <ThemeCustomizer />
      </div>
      {/* The material everything is made of. Above the layout section because
          it is the change people come here to make — and because choosing one
          moves more of the interface than any other control on this page. */}
      <div className='mt-24px pt-24px border-t border-fill-2'>
        <MaterialStudio />
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
