/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, render, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FOOL_VOICE_SETTINGS, type FoolVoiceSettings } from '@/common/types/foolVoice';
import { useWakeWordListener } from '@renderer/hooks/voice/useWakeWordListener';

const getPetEnabled = vi.fn();
const configSubscribers = new Map<string, (value: unknown) => void>();
const manualListeners = new Set<(active: boolean) => void>();

const session = {
  state: { phase: 'idle', condition: { status: 'normal' }, enteredAtMs: 0 },
  missingModelId: null,
  isActive: false,
  start: vi.fn(),
  startWakeListening: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn(),
};

let settings: FoolVoiceSettings = DEFAULT_FOOL_VOICE_SETTINGS;
let manualActive = false;

const catalogInvoke = vi.fn().mockResolvedValue({ ok: true, data: { models: [], profiles: [], providers: [] } });

vi.mock('@/common/adapter/ipcBridge', () => ({
  systemSettings: { getPetEnabled: { invoke: () => getPetEnabled() } },
  foolVoice: { catalog: { invoke: (request: unknown) => catalogInvoke(request) } },
}));

vi.mock('@/common/config/configService', () => ({
  configService: {
    subscribe: (key: string, callback: (value: unknown) => void) => {
      configSubscribers.set(key, callback);
      return () => configSubscribers.delete(key);
    },
  },
}));

vi.mock('@renderer/hooks/voice/useFoolVoiceSettings', () => ({
  useFoolVoiceSettings: () => ({ settings, ready: true, update: vi.fn() }),
}));

vi.mock('@renderer/hooks/voice/useFoolVoiceSession', () => ({
  useFoolVoiceSession: () => session,
  isManualVoiceSessionActive: () => manualActive,
  subscribeManualVoiceSession: (listener: (active: boolean) => void) => {
    manualListeners.add(listener);
    return () => manualListeners.delete(listener);
  },
}));

const Harness: React.FC = () => {
  useWakeWordListener();
  return null;
};

describe('useWakeWordListener', () => {
  beforeEach(() => {
    session.startWakeListening.mockClear();
    session.stop.mockClear();
    configSubscribers.clear();
    manualListeners.clear();
    manualActive = false;
    settings = DEFAULT_FOOL_VOICE_SETTINGS;
  });

  it('listens once the desktop pet is on', async () => {
    getPetEnabled.mockResolvedValue(true);

    render(<Harness />);

    await waitFor(() => expect(session.startWakeListening).toHaveBeenCalledTimes(1));
  });

  /**
   * The pet used to gate this, and no longer does.
   *
   * Saying the wake phrase is how this app is spoken to; hiding the character
   * on screen is a decision about the character. Tying the two meant a user who
   * turned the pet off lost the wake word with it and had nothing in the voice
   * settings to explain why.
   */
  it('listens whether or not the pet is on screen', async () => {
    getPetEnabled.mockResolvedValue(false);

    render(<Harness />);

    await waitFor(() => expect(session.startWakeListening).toHaveBeenCalledTimes(1));
  });

  it('keeps listening when the pet is switched off mid-session', async () => {
    getPetEnabled.mockResolvedValue(true);
    render(<Harness />);
    await waitFor(() => expect(session.startWakeListening).toHaveBeenCalled());

    act(() => configSubscribers.get('pet.enabled')?.(false));

    await waitFor(() => expect(session.startWakeListening).toHaveBeenCalledTimes(1));
    expect(session.stop).not.toHaveBeenCalled();
  });

  it('stands down while the user is deliberately talking', async () => {
    getPetEnabled.mockResolvedValue(true);
    render(<Harness />);
    await waitFor(() => expect(session.startWakeListening).toHaveBeenCalled());

    act(() => {
      for (const listener of manualListeners) listener(true);
    });

    await waitFor(() => expect(session.stop).toHaveBeenCalled());
  });

  it('does not listen when the wake phrase is switched off, pet or no pet', async () => {
    getPetEnabled.mockResolvedValue(true);
    settings = {
      ...DEFAULT_FOOL_VOICE_SETTINGS,
      activation: {
        ...DEFAULT_FOOL_VOICE_SETTINGS.activation,
        wakePhrase: { ...DEFAULT_FOOL_VOICE_SETTINGS.activation.wakePhrase, enabled: false },
      },
    };

    render(<Harness />);

    await waitFor(() => expect(session.stop).toHaveBeenCalled());
    expect(session.startWakeListening).not.toHaveBeenCalled();
  });

  it('is not stopped by a pet setting it cannot read', async () => {
    getPetEnabled.mockRejectedValue(new Error('no ipc'));

    render(<Harness />);

    await waitFor(() => expect(session.startWakeListening).toHaveBeenCalledTimes(1));
  });
});
