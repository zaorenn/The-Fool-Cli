/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceTurnState } from '@/common/types/foolVoice';
import VoiceTalkButton from '@renderer/components/chat/VoiceTalkButton';

const idle: VoiceTurnState = { phase: 'idle', condition: { status: 'normal' }, enteredAtMs: 0 };
const listening: VoiceTurnState = {
  phase: 'command-listening',
  sessionId: 's1',
  clientTurnId: 't1',
  condition: { status: 'normal' },
  enteredAtMs: 0,
};

const session = {
  state: idle as VoiceTurnState,
  missingModelId: null as string | null,
  isActive: false,
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn(),
};

vi.mock('@renderer/hooks/voice/useFoolVoiceSession', () => ({
  useFoolVoiceSession: () => session,
  VOICE_SUBMIT_EVENT: 'fool:voice-submit',
}));

let wakeState: 'off' | 'listening' | 'awake' = 'off';
const wakeSubscribers = new Set<(state: 'off' | 'listening' | 'awake') => void>();

vi.mock('@renderer/hooks/voice/useWakeWordListener', () => ({
  peekWakeListenerState: () => wakeState,
  subscribeWakeListener: (listener: (state: 'off' | 'listening' | 'awake') => void) => {
    wakeSubscribers.add(listener);
    return () => wakeSubscribers.delete(listener);
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('VoiceTalkButton', () => {
  beforeEach(() => {
    session.state = idle;
    session.missingModelId = null;
    session.start.mockClear();
    session.stop.mockClear();
  });

  it('renders regardless of the optional speech-to-text tool setting', () => {
    render(<VoiceTalkButton />);

    expect(screen.getByRole('button', { name: 'conversation.chat.voice.startTalk' })).toBeTruthy();
  });

  it('starts a session when idle', async () => {
    render(<VoiceTalkButton />);
    fireEvent.click(screen.getByRole('button', { name: 'conversation.chat.voice.startTalk' }));

    await waitFor(() => expect(session.start).toHaveBeenCalled());
  });

  it('stops an active session instead of starting a second one', () => {
    session.state = listening;
    render(<VoiceTalkButton />);

    fireEvent.click(screen.getByRole('button', { name: 'conversation.chat.voice.stopTalk' }));

    expect(session.stop).toHaveBeenCalled();
    expect(session.start).not.toHaveBeenCalled();
  });

  it('routes to the install flow instead of starting when a model is missing', () => {
    session.missingModelId = 'tts-kokoro-en-v0_19-int8';
    const onRequestModelInstall = vi.fn();

    render(<VoiceTalkButton onRequestModelInstall={onRequestModelInstall} />);
    fireEvent.click(screen.getByRole('button', { name: 'conversation.chat.voice.installNeeded' }));

    expect(session.start).not.toHaveBeenCalled();
    expect(onRequestModelInstall).toHaveBeenCalledWith('tts-kokoro-en-v0_19-int8');
  });

  it('stops the session when starting fails', async () => {
    session.start.mockRejectedValueOnce(new Error('device-unavailable'));
    render(<VoiceTalkButton />);

    fireEvent.click(screen.getByRole('button', { name: 'conversation.chat.voice.startTalk' }));

    await waitFor(() => expect(session.stop).toHaveBeenCalled());
  });

  it('is disabled while the composer is disabled', () => {
    render(<VoiceTalkButton disabled />);

    expect(screen.getByRole('button', { name: 'conversation.chat.voice.startTalk' })).toHaveProperty('disabled', true);
  });

  it('shows that the wake word is being listened for, so an open microphone is visible', () => {
    wakeState = 'listening';
    render(<VoiceTalkButton />);

    const button = screen.getByTestId('voice-talk');
    expect(button.getAttribute('data-wake')).toBe('listening');
    expect(button.getAttribute('aria-label')).toBe('conversation.chat.voice.wakeArmed');
    wakeState = 'off';
  });

  it('says nothing about the wake word once a session is running', () => {
    wakeState = 'listening';
    session.state = listening;
    render(<VoiceTalkButton />);

    const button = screen.getByTestId('voice-talk');
    expect(button.getAttribute('data-wake')).toBeNull();
    expect(button.getAttribute('aria-label')).toBe('conversation.chat.voice.stopTalk');
    wakeState = 'off';
  });
});
