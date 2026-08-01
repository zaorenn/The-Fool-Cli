/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { VoiceModel, VoiceParamSpec } from '@/common/types/foolVoice';
import VoiceParamsSection from '@renderer/components/settings/SettingsModal/contents/voice/tts/VoiceParamsSection';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const SPECS: VoiceParamSpec[] = [
  { name: 'temperature', type: 'number', min: 0.05, max: 2, step: 0.05, default: 0.8 },
  { name: 'do_sample', type: 'boolean', default: true },
  { name: 'emotion_text', type: 'text', maxLength: 200, default: '' },
];

const speechModel = (paramSpecs?: VoiceParamSpec[]): VoiceModel =>
  ({
    id: 'tts-audiocpp-chatterbox',
    providerId: 'local-audiocpp',
    displayName: 'Chatterbox',
    languages: ['en'],
    role: 'text-to-speech',
    distribution: 'managed',
    state: { status: 'ready' },
    downloadBytes: null,
    installedBytes: null,
    audioOutput: { container: 'wav', encoding: 'pcm16le', channels: 1 },
    profileIds: [],
    ...(paramSpecs ? { paramSpecs } : {}),
  }) as VoiceModel;

const setup = (model: VoiceModel | undefined, params: Record<string, number | boolean | string> = {}) => {
  const onChange = vi.fn();
  render(<VoiceParamsSection model={model} params={params} onChange={onChange} />);
  return { onChange };
};

describe('VoiceParamsSection', () => {
  /**
   * The engine's own schema is the only list of knobs. A control that is not in
   * it would be sending a key the IPC validator rejects, so the section is built
   * from what the model carries rather than from anything kept here.
   */
  it('shows a control for every parameter the engine declares', () => {
    setup(speechModel(SPECS));

    expect(screen.getByTestId('voice-param-temperature')).toBeTruthy();
    expect(screen.getByTestId('voice-param-do_sample')).toBeTruthy();
    expect(screen.getByTestId('voice-param-emotion_text')).toBeTruthy();
  });

  // Names are the engine's wire spelling, not prose: `do_sample` is what
  // upstream's documentation calls it, and a translated label would name
  // something that appears nowhere else.
  it('names each parameter exactly as the engine spells it', () => {
    setup(speechModel(SPECS));

    expect(screen.getByText('temperature')).toBeTruthy();
    expect(screen.getByText('do_sample')).toBeTruthy();
  });

  it('shows nothing at all for an engine with no knobs', () => {
    setup(speechModel());

    expect(screen.queryByTestId('voice-params')).toBeNull();
  });

  it('shows nothing while the catalog is still loading', () => {
    setup(undefined);

    expect(screen.queryByTestId('voice-params')).toBeNull();
  });

  it('reports a changed value under the engine’s own key', () => {
    const { onChange } = setup(speechModel(SPECS));

    fireEvent.click(screen.getByTestId('voice-param-do_sample'));

    expect(onChange).toHaveBeenCalledWith({ do_sample: false });
  });

  it('keeps the values already set when one more is changed', () => {
    const { onChange } = setup(speechModel(SPECS), { temperature: 1.2 });

    fireEvent.click(screen.getByTestId('voice-param-do_sample'));

    expect(onChange).toHaveBeenCalledWith({ temperature: 1.2, do_sample: false });
  });

  /**
   * Resetting empties the record rather than writing every default back into it.
   * An absent key means "whatever the engine's own struct initialiser says", so
   * an upstream default that changes is followed instead of frozen at the value
   * it happened to have when this page was last opened.
   */
  it('resets by forgetting the values rather than by storing the defaults', () => {
    const { onChange } = setup(speechModel(SPECS), { temperature: 1.2 });

    fireEvent.click(screen.getByTestId('voice-params-reset'));

    expect(onChange).toHaveBeenCalledWith({});
  });

  it('has nothing to reset when nothing has been changed', () => {
    setup(speechModel(SPECS));

    expect((screen.getByTestId('voice-params-reset') as HTMLButtonElement).disabled).toBe(true);
  });
});
