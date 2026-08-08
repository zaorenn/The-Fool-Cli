/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_FOOL_VOICE_SETTINGS, parseFoolVoiceSettings } from '@/common/types/foolVoice';

describe('the spoken runtime choice', () => {
  it('keeps the renderer loop until the setting says otherwise', () => {
    // Off until the measurement says the move costs nothing. A flag that opens
    // on an argument rather than a number is how the slower path ships.
    expect(DEFAULT_FOOL_VOICE_SETTINGS.realtime.useAgentRuntime).toBe(false);
  });

  it('survives a settings document written before the field existed', () => {
    const { useAgentRuntime: _dropped, ...withoutTheField } = DEFAULT_FOOL_VOICE_SETTINGS.realtime;
    const parsed = parseFoolVoiceSettings({
      ...DEFAULT_FOOL_VOICE_SETTINGS,
      realtime: withoutTheField,
    });

    expect(parsed.realtime.useAgentRuntime).toBe(false);
  });

  it('keeps the choice when it is switched on', () => {
    const parsed = parseFoolVoiceSettings({
      ...DEFAULT_FOOL_VOICE_SETTINGS,
      realtime: { ...DEFAULT_FOOL_VOICE_SETTINGS.realtime, useAgentRuntime: true },
    });

    expect(parsed.realtime.useAgentRuntime).toBe(true);
  });
});
