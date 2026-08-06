/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_VOICE_MEMORY, rememberFact, type VoiceMemory } from '@/common/voice/memory';

/**
 * What is remembered, shown to the person it is about.
 *
 * The memory used to be a config blob: it worked, and the only way to find out
 * what was in it was to ask out loud and hope the answer was not invented. For a
 * memory that is the worst possible property — the one thing someone needs to be
 * able to do with what a machine believes about them is read it and cross it
 * out.
 */

let stored: VoiceMemory = EMPTY_VOICE_MEMORY;
const listeners = new Set<(memory: VoiceMemory) => void>();
const saved: { which: string; text: string }[] = [];

vi.mock('@renderer/services/voice/session/voiceMemoryStore', () => ({
  peekVoiceMemory: () => stored,
  readVoiceMemory: async () => stored,
  subscribeVoiceMemory: (listener: (memory: VoiceMemory) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  writeMemoryDoc: async (which: 'user' | 'agent', text: string) => {
    saved.push({ which, text });
    // Tidied on the way in, the way the real store does: what comes back is
    // rarely byte-identical to what was typed.
    stored = { ...stored, [which]: `${text.trim()}\n` };
    for (const listener of listeners) listener(stored);
    return stored;
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const MemorySettings = (await import('@renderer/components/settings/SettingsModal/contents/memory')).default;

/** Pushes a change from a conversation running in the background. */
const learn = (fact: string): void => {
  stored = rememberFact(stored, fact);
  for (const listener of listeners) listener(stored);
};

const userEditor = (): HTMLTextAreaElement => screen.getByTestId('memory-user-doc') as HTMLTextAreaElement;

beforeEach(() => {
  stored = { ...EMPTY_VOICE_MEMORY, introduced: true };
  listeners.clear();
  saved.length = 0;
});

describe('the memory settings page', () => {
  it('shows the document itself, not a rendering of it', async () => {
    stored = rememberFact(stored, 'Uses Windows 11.');
    render(<MemorySettings />);

    await waitFor(() => expect(userEditor().value).toContain('Uses Windows 11.'));
    expect(userEditor().value).toContain('## What I know about you');
  });

  it('writes an edit back as the whole document', async () => {
    render(<MemorySettings />);
    await waitFor(() => expect(userEditor()).toBeTruthy());

    fireEvent.change(userEditor(), { target: { value: '# About you\n\n- I moved to Ankara.\n' } });
    fireEvent.click(screen.getByText('common.save'));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toEqual({ which: 'user', text: '# About you\n\n- I moved to Ankara.\n' });
  });

  /**
   * A conversation can learn the user's name while they are reading the file it
   * is written to. Watching it appear is the clearest possible answer to "is it
   * actually remembering anything".
   */
  it('follows the document when a conversation writes to it', async () => {
    render(<MemorySettings />);
    await waitFor(() => expect(userEditor()).toBeTruthy());

    learn('Builds a desktop app called The Fool.');

    await waitFor(() => expect(userEditor().value).toContain('Builds a desktop app called The Fool.'));
  });

  /**
   * And does not, when they are halfway through a sentence. Taking someone's
   * half-written line away is worse than being a moment out of date.
   */
  it('keeps what is being typed when a conversation writes underneath it', async () => {
    render(<MemorySettings />);
    await waitFor(() => expect(userEditor()).toBeTruthy());

    fireEvent.change(userEditor(), { target: { value: '# About you\n\n- I am halfway through' } });
    learn('Uses Windows 11.');

    await waitFor(() => expect(screen.getByText('settings.memory.unsaved')).toBeTruthy());
    expect(userEditor().value).toBe('# About you\n\n- I am halfway through');
  });

  /**
   * The store tidies what it is given, so the text that lands is not the text
   * that was typed. Compared naively, the editor reads "unsaved changes"
   * immediately after a successful save — the one moment it must not.
   */
  it('settles after a save, even though the stored text is not byte-identical', async () => {
    render(<MemorySettings />);
    await waitFor(() => expect(userEditor()).toBeTruthy());

    fireEvent.change(userEditor(), { target: { value: '# About you\n\n- I moved to Ankara.' } });
    fireEvent.click(screen.getByText('common.save'));

    await waitFor(() => expect(screen.getByText('settings.memory.upToDate')).toBeTruthy());
    expect(userEditor().value).toBe('# About you\n\n- I moved to Ankara.\n');
  });

  it('offers no save until something has actually changed', async () => {
    render(<MemorySettings />);
    await waitFor(() => expect(userEditor()).toBeTruthy());

    expect(screen.getByText('settings.memory.upToDate')).toBeTruthy();
    expect(screen.getByText('common.save').closest('button')?.getAttribute('disabled')).not.toBeNull();
  });
});
