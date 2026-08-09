/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_FOOL_VOICE_SETTINGS, parseFoolVoiceSettings } from '@/common/types/foolVoice';

describe('the spoken runtime choice', () => {
  it('thinks on the agent runtime unless it is told not to', () => {
    // The measurement opened it: deferred tools took 36% off the prompt and the
    // compactor works against the model's real window. What it does not buy is
    // a faster first word, which is why the switch stays.
    expect(DEFAULT_FOOL_VOICE_SETTINGS.realtime.useAgentRuntime).toBe(true);
  });

  it('survives a settings document written before the field existed', () => {
    const { useAgentRuntime: _dropped, ...withoutTheField } = DEFAULT_FOOL_VOICE_SETTINGS.realtime;
    const parsed = parseFoolVoiceSettings({
      ...DEFAULT_FOOL_VOICE_SETTINGS,
      realtime: withoutTheField,
    });

    expect(parsed.realtime.useAgentRuntime).toBe(true);
  });

  it('keeps the choice when it is switched off', () => {
    const parsed = parseFoolVoiceSettings({
      ...DEFAULT_FOOL_VOICE_SETTINGS,
      realtime: { ...DEFAULT_FOOL_VOICE_SETTINGS.realtime, useAgentRuntime: false },
    });

    expect(parsed.realtime.useAgentRuntime).toBe(false);
  });
});
