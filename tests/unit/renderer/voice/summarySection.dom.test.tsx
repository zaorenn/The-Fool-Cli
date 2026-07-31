/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FOOL_VOICE_SETTINGS, type FoolVoiceSettings } from '@/common/types/foolVoice';
import SummarySection from '@renderer/components/settings/SettingsModal/contents/voice/SummarySection';

const summaryPlanInvoke = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: { foolVoice: { summaryPlan: { invoke: (request: unknown) => summaryPlanInvoke(request) } } },
}));

vi.mock('@arco-design/web-react', () => ({
  Switch: ({
    checked,
    onChange,
    ...props
  }: {
    checked?: boolean;
    onChange?: (value: boolean) => void;
  } & React.ComponentProps<'input'>) => (
    <input type='checkbox' checked={checked} onChange={(event) => onChange?.(event.target.checked)} {...props} />
  ),
  Tag: ({ children, ...props }: React.ComponentProps<'span'>) => <span {...props}>{children}</span>,
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const settings = (overrides: Partial<FoolVoiceSettings['summary']> = {}): FoolVoiceSettings => ({
  ...DEFAULT_FOOL_VOICE_SETTINGS,
  summary: { ...DEFAULT_FOOL_VOICE_SETTINGS.summary, ...overrides },
});

describe('SummarySection', () => {
  beforeEach(() => {
    summaryPlanInvoke.mockReset();
    summaryPlanInvoke.mockResolvedValue({
      ok: true,
      data: { modelId: 'qwen3-4b', displayName: 'qwen3-4b', loaded: true, local: true, origin: 'loaded' },
    });
  });

  it('names the model that would do the summarising', async () => {
    render(<SummarySection settings={settings()} onChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('voice-summary-model').textContent).toBe('qwen3-4b'));
  });

  it('warns that a cold model makes the first answer slow', async () => {
    summaryPlanInvoke.mockResolvedValue({
      ok: true,
      data: { modelId: 'gemma-3-27b', displayName: 'gemma-3-27b', loaded: false, local: true, origin: 'installed' },
    });

    render(<SummarySection settings={settings()} onChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('settings.voice.summaryModelCold')).toBeTruthy());
  });

  it('says replies will be spoken as written when nothing can summarise', async () => {
    summaryPlanInvoke.mockResolvedValue({
      ok: true,
      data: { modelId: '', displayName: '', loaded: false, local: false, origin: 'none' },
    });

    render(<SummarySection settings={settings()} onChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('voice-summary-no-model')).toBeTruthy());
  });

  it('says the same when the plan cannot be asked for at all', async () => {
    summaryPlanInvoke.mockRejectedValue(new Error('unavailable'));

    render(<SummarySection settings={settings()} onChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('voice-summary-no-model')).toBeTruthy());
  });

  it('asks for no model while the switch is off', async () => {
    render(<SummarySection settings={settings({ translateToEnglish: false })} onChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('voice-summary-enabled')).toBeTruthy());
    expect(summaryPlanInvoke).not.toHaveBeenCalled();
  });

  it('turns the setting off in one click', async () => {
    const onChange = vi.fn();
    render(<SummarySection settings={settings()} onChange={onChange} />);

    fireEvent.click(screen.getByTestId('voice-summary-enabled'));

    const change = onChange.mock.calls[0][0] as (previous: FoolVoiceSettings) => FoolVoiceSettings;
    expect(change(settings()).summary.translateToEnglish).toBe(false);
  });

  it('offers the pinned model to the resolver', async () => {
    render(<SummarySection settings={settings({ modelId: 'pinned-model' })} onChange={vi.fn()} />);

    await waitFor(() => expect(summaryPlanInvoke).toHaveBeenCalled());
    const request = summaryPlanInvoke.mock.calls[0][0] as { payload: Record<string, string> };
    expect(request.payload.modelId).toBe('pinned-model');
  });
});
