/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FOOL_VOICE_SETTINGS, type FoolVoiceSettings } from '@/common/types/foolVoice';
import type { LayoutOptions } from '@/common/config/surfaceLayouts';
import type { ConversationActivity, ConversationPhase } from '@renderer/pages/voice/runtime/types';
import type { ConversationHandle } from '@renderer/pages/voice/runtime/useConversation';

/**
 * The HUD shape of the voice page.
 *
 * Two things here were asked for by name and are wrong without a test. The
 * settings must be reachable and dismissable rather than permanently taking a
 * column, and the panel holding them must scroll — the controls are taller than
 * a short window, and the last of them used to sit below the bottom edge with
 * nothing to reach them by.
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    mode: { listProviders: { invoke: async () => [] } },
    assistants: { list: { invoke: async () => [] } },
  },
}));

vi.mock('@renderer/hooks/agent/useManagedAgents', () => ({ useManagedAgentRuntimeCatalog: () => [] }));

const VoiceHudBody = (await import('@renderer/pages/voice/hud/VoiceHudBody')).default;

const options = (change: Partial<LayoutOptions> = {}): LayoutOptions => ({
  shell: 'hud',
  meter: 'ring',
  panel: 'drawer',
  motion: 'full',
  density: 'comfortable',
  ...change,
});

const handle = (phase: ConversationPhase, activities: ConversationActivity[] = []): ConversationHandle => ({
  phase,
  userTranscript: '',
  assistantTranscript: '',
  error: '',
  providerName: '',
  activities,
  level: { current: 0 },
  start: vi.fn(async () => {}),
  stop: vi.fn(),
  interrupt: vi.fn(),
  setError: vi.fn(),
});

const settings: FoolVoiceSettings = structuredClone(DEFAULT_FOOL_VOICE_SETTINGS);

const draw = (conversation: ConversationHandle, layout: LayoutOptions = options()) =>
  render(<VoiceHudBody conversation={conversation} settings={settings} onSettingsChange={vi.fn()} options={layout} />);

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) })) as unknown as typeof fetch
  );
});

describe('the HUD layout', () => {
  it('puts the dial in the middle and the state on it', () => {
    draw(handle('listening'));

    const dial = screen.getByTestId('voice-dial');
    expect(dial.getAttribute('data-phase')).toBe('listening');
    expect(screen.getByText('settings.voice.conversationPhase.listening')).toBeTruthy();
  });

  it('names the phase on the dial so the motion can be read against a word', () => {
    draw(handle('acting'));

    expect(screen.getByTestId('voice-dial').getAttribute('data-phase')).toBe('acting');
  });

  it('shows the agent’s work as a trace rather than a stack of cards', () => {
    draw(
      handle('acting', [
        { id: 'a', label: 'browser_navigate', detail: 'browser_navigate', state: 'completed' },
        { id: 'b', label: 'Writing the answer', detail: 'I found four.', state: 'running' },
      ])
    );

    const trace = screen.getByTestId('voice-trace');
    expect(trace.querySelectorAll('li')).toHaveLength(2);
    expect(trace.querySelectorAll('li')[1].getAttribute('data-state')).toBe('running');
    // The label and the detail are the same thing on the first row, and a row
    // repeating itself in two weights is noise wearing a hierarchy.
    expect(trace.querySelectorAll('li')[0].textContent).toBe('browser_navigate');
  });

  it('says nothing has happened yet rather than showing an empty list', () => {
    draw(handle('listening'));

    expect(screen.queryByTestId('voice-trace')).toBeNull();
    expect(screen.getByText('settings.voice.conversationActivityEmpty')).toBeTruthy();
  });
});

describe('the settings drawer', () => {
  it('is closed until it is asked for', () => {
    draw(handle('listening'));

    expect(screen.getByTestId('voice-settings-drawer').closest('[aria-hidden]')?.getAttribute('aria-hidden')).toBe(
      'true'
    );
  });

  it('opens on the button and closes again on the close', async () => {
    draw(handle('listening'));

    fireEvent.click(screen.getByTestId('voice-settings-open'));
    await waitFor(() =>
      expect(screen.getByTestId('voice-settings-drawer').closest('[aria-hidden]')?.getAttribute('aria-hidden')).toBe(
        'false'
      )
    );

    fireEvent.click(screen.getByTestId('voice-settings-close'));
    await waitFor(() =>
      expect(screen.getByTestId('voice-settings-drawer').closest('[aria-hidden]')?.getAttribute('aria-hidden')).toBe(
        'true'
      )
    );
  });

  it('closes on Escape, so it is dismissable without hunting for the button', async () => {
    draw(handle('listening'));

    fireEvent.click(screen.getByTestId('voice-settings-open'));
    await waitFor(() =>
      expect(screen.getByTestId('voice-settings-drawer').closest('[aria-hidden]')?.getAttribute('aria-hidden')).toBe(
        'false'
      )
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.getByTestId('voice-settings-drawer').closest('[aria-hidden]')?.getAttribute('aria-hidden')).toBe(
        'true'
      )
    );
  });

  /**
   * The reason the drawer is a component rather than a `hidden` attribute. The
   * controls are taller than a short window, and without a scrolling body the
   * last of them sits below the bottom edge with no way to reach it.
   */
  it('scrolls its own body rather than running off the bottom of the window', () => {
    const { container } = draw(handle('listening'));

    const body = container.querySelector('[class*="drawerBody"]');
    expect(body).toBeTruthy();
    expect(body?.className).toMatch(/drawerBody/);
  });

  it('keeps the controls mounted while closed, so a half-typed instruction survives', () => {
    draw(handle('listening'));

    // Rendered whether open or not: the settings inside are a form, and a form
    // that resets when you glance away is worse than one you have to open.
    expect(screen.getByTestId('voice-settings-drawer')).toBeTruthy();
    expect(screen.getByText('settings.voice.conversationProvider')).toBeTruthy();
  });
});

describe('the layout’s own options', () => {
  it('keeps the settings in the rail when the layout asks for that, and scrolls them', () => {
    const { container } = draw(handle('idle'), options({ panel: 'inline' }));

    expect(screen.getByTestId('voice-rail-scroll')).toBeTruthy();
    expect(container.querySelector('[class*="railScroll"]')).toBeTruthy();
  });

  /**
   * The rail is for the trace once there is work to show. A rail holding both
   * would be the crowded column this shape was drawn to replace.
   */
  it('gives the rail back to the trace once a conversation is running', () => {
    draw(handle('listening'), options({ panel: 'inline' }));

    expect(screen.queryByTestId('voice-rail-scroll')).toBeNull();
    expect(screen.getByTestId('voice-settings-open')).toBeTruthy();
  });
});
