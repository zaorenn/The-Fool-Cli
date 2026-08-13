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

/**
 * There used to be a colour customiser here: four hex pickers for accent,
 * background, panels and text. It has gone, and its absence is the point.
 *
 * Those four values were stored without any idea which appearance was showing,
 * and they outranked the material — so a ground chosen in the dark kept winning
 * in light mode, and choosing a different material visibly failed to move most
 * of the interface. An arbitrary point on a colour wheel also carries no
 * promise that anything remains readable, which is how a 2.41:1 button label
 * shipped.
 *
 * Colour is chosen in the Material section now, from a list whose every member
 * is checked against every material in both appearances.
 */
const AppearanceSettings: React.FC = () => {
  return (
    <SettingsPageWrapper>
      <AppearanceModalContent />
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
