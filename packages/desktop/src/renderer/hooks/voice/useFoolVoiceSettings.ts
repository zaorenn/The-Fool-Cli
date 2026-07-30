/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import type { FoolVoiceSettings } from '@/common/types/foolVoice';
import {
  peekVoiceSettings,
  readVoiceSettings,
  subscribeVoiceSettings,
  writeVoiceSettings,
} from '@renderer/services/voice/voiceSettingsStore';

export type FoolVoiceSettingsHandle = {
  settings: FoolVoiceSettings;
  /** False until the stored settings have been read, so a save cannot race the load. */
  ready: boolean;
  /** Applies a change everywhere and persists it. */
  update: (change: (previous: FoolVoiceSettings) => FoolVoiceSettings) => void;
};

/**
 * Reads the persisted voice settings and keeps this component in step with
 * changes made anywhere else in the app.
 */
export const useFoolVoiceSettings = (): FoolVoiceSettingsHandle => {
  const [settings, setSettings] = useState<FoolVoiceSettings>(peekVoiceSettings);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;

    void readVoiceSettings().then((stored) => {
      if (!active) return;
      setSettings(stored);
      setReady(true);
    });

    const unsubscribe = subscribeVoiceSettings((next) => {
      if (active) setSettings(next);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const update = useCallback((change: (previous: FoolVoiceSettings) => FoolVoiceSettings) => {
    // Derived from the store rather than from React state so two quick edits
    // cannot drop the first one.
    void writeVoiceSettings(change(peekVoiceSettings()));
  }, []);

  return { settings, ready, update };
};
