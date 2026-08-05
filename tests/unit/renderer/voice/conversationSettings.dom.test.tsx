/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FOOL_VOICE_SETTINGS, type FoolVoiceSettings } from '@/common/types/foolVoice';

/**
 * Everything a conversation is configured with, on the screen that starts it.
 *
 * "I need to be able to enter the models and their instructions comfortably, from
 * the same surface" is a requirement about one panel rather than about five
 * settings pages. So this asserts the panel beside the microphone offers the
 * model that thinks, the model that sees, where they answer, who the voice is
 * being and what it has been told — and that the pickers are populated from the
 * local server rather than asking the user to type an id like
 * `google/gemma-4-e4b` exactly.
 */

const listProviders = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: { mode: { listProviders: { invoke: () => listProviders() } } },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const ConversationSettings = (await import('@renderer/pages/voice/ConversationSettings')).default;

const settings = (change: Partial<FoolVoiceSettings['realtime']> = {}): FoolVoiceSettings => ({
  ...structuredClone(DEFAULT_FOOL_VOICE_SETTINGS),
  realtime: { ...DEFAULT_FOOL_VOICE_SETTINGS.realtime, providerId: 'local-pipeline', ...change },
});

beforeEach(() => {
  listProviders.mockReset().mockResolvedValue([]);
  // The picker reads the loaded models off the local server.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: 'google/gemma-4-e4b' }, { id: 'qwen/qwen3-vl-8b' }] }),
    })) as unknown as typeof fetch
  );
});

describe('the panel beside the microphone', () => {
  it('offers both models, where they answer, and what they were told', async () => {
    render(<ConversationSettings settings={settings()} disabled={false} onChange={vi.fn()} />);

    // The thinking model and the one that looks at the screen are separate
    // choices, because the fast conversational model is often text-only.
    expect(screen.getByText('settings.voice.conversationLocalModel')).toBeTruthy();
    expect(screen.getByText('settings.voice.conversationVisionModel')).toBeTruthy();
    expect(screen.getByText('settings.voice.conversationLocalEndpoint')).toBeTruthy();
    expect(screen.getByText('settings.voice.conversationPersona')).toBeTruthy();
    // Custom instructions, which is the "and their instructions" half.
    expect(screen.getByPlaceholderText('settings.voice.conversationInstructionsPlaceholder')).toBeTruthy();
  });

  it('asks the local server what it has, rather than expecting an exact id typed', async () => {
    render(
      <ConversationSettings
        settings={settings({ localEndpoint: 'http://127.0.0.1:9000/v1' })}
        disabled={false}
        onChange={vi.fn()}
      />
    );

    // `google/gemma-4-e4b`, slash and all, is not something to retype: a typo is
    // indistinguishable from the model being unavailable. The options are drawn
    // in a portal only once the picker is opened, so what is asserted here is the
    // fetch that fills them — and that it went to the configured endpoint rather
    // than a hardcoded one.
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const urls = (fetch as unknown as { mock: { calls: [string][] } }).mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => url === 'http://127.0.0.1:9000/v1/models')).toBe(true);
  });

  it('says the vision model follows the thinking one when it is left alone', async () => {
    render(<ConversationSettings settings={settings()} disabled={false} onChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('settings.voice.conversationVisionModelSame')).toBeTruthy());
  });
});
