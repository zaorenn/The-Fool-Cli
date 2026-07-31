/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProvider } from '@/common/config/storage';
import { DEFAULT_FOOL_VOICE_SETTINGS, type FoolVoiceSettings } from '@/common/types/foolVoice';
import SummarySection from '@renderer/components/settings/SettingsModal/contents/voice/SummarySection';

const summaryPlanInvoke = vi.fn();
const providerListMock = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: { foolVoice: { summaryPlan: { invoke: (request: unknown) => summaryPlanInvoke(request) } } },
}));

vi.mock('@renderer/hooks/agent/useModelProviderList', () => ({
  useModelProviderList: () => providerListMock(),
}));

type OptionProps = { value: string; children?: React.ReactNode };
type OptGroupProps = { label?: React.ReactNode; children?: React.ReactNode };

/** Flattens `Select.Option`/`Select.OptGroup` children into a native `<option>` list. */
const flattenOptions = (node: React.ReactNode): Array<{ value: string; label: React.ReactNode }> =>
  React.Children.toArray(node).flatMap((child) => {
    if (!React.isValidElement(child)) return [];
    const props = child.props as Partial<OptionProps & OptGroupProps>;
    if (typeof props.value === 'string') return [{ value: props.value, label: props.children }];
    if (props.children) return flattenOptions(props.children);
    return [];
  });

vi.mock('@arco-design/web-react', () => ({
  Select: Object.assign(
    ({
      value,
      onChange,
      children,
      ...props
    }: {
      value?: string;
      onChange?: (value: string) => void;
      children?: React.ReactNode;
    } & React.ComponentProps<'select'>) => (
      <select value={value} onChange={(event) => onChange?.(event.target.value)} {...props}>
        {flattenOptions(children).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    ),
    {
      Option: ({ children }: OptionProps) => <>{children}</>,
      OptGroup: ({ children }: OptGroupProps) => <>{children}</>,
    }
  ),
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

const provider = (overrides: Partial<IProvider> = {}): IProvider => ({
  id: 'openai-1',
  platform: 'openai',
  name: 'My OpenAI',
  base_url: 'https://api.openai.com/v1',
  api_key: 'x',
  models: ['gpt-4o', 'text-embedding-3-large'],
  enabled: true,
  ...overrides,
});

describe('SummarySection', () => {
  beforeEach(() => {
    summaryPlanInvoke.mockReset();
    summaryPlanInvoke.mockResolvedValue({
      ok: true,
      data: { modelId: 'qwen3-4b', displayName: 'qwen3-4b', loaded: true, local: true, origin: 'loaded' },
    });
    providerListMock.mockReset();
    providerListMock.mockReturnValue({
      providers: [provider()],
      getAvailableModels: () => [],
      formatModelLabel: (_provider: unknown, modelName?: string) => modelName ?? '',
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

  it('lists chat-capable models across connected providers, excluding embeddings', async () => {
    render(<SummarySection settings={settings()} onChange={vi.fn()} />);

    const picker = (await screen.findByTestId('voice-summary-model-picker')) as HTMLSelectElement;
    const optionValues = Array.from(picker.options).map((option) => option.value);
    expect(optionValues).toContain('gpt-4o');
    expect(optionValues).not.toContain('text-embedding-3-large');
  });

  it('pins the chosen model into settings.summary.modelId', async () => {
    const onChange = vi.fn();
    render(<SummarySection settings={settings()} onChange={onChange} />);

    const picker = await screen.findByTestId('voice-summary-model-picker');
    fireEvent.change(picker, { target: { value: 'gpt-4o' } });

    const updater = onChange.mock.calls[0][0] as (previous: FoolVoiceSettings) => FoolVoiceSettings;
    expect(updater(settings()).summary.modelId).toBe('gpt-4o');
  });

  it('choosing "automatically" clears the pin', async () => {
    const onChange = vi.fn();
    render(<SummarySection settings={settings({ modelId: 'gpt-4o' })} onChange={onChange} />);

    const picker = await screen.findByTestId('voice-summary-model-picker');
    fireEvent.change(picker, { target: { value: '' } });

    const updater = onChange.mock.calls[0][0] as (previous: FoolVoiceSettings) => FoolVoiceSettings;
    expect(updater(settings({ modelId: 'gpt-4o' })).summary.modelId).toBe('');
  });

  it('excludes a model the provider disabled', async () => {
    providerListMock.mockReturnValue({
      providers: [
        provider({ models: ['gpt-4o', 'gpt-4o-mini'], model_enabled: { 'gpt-4o': true, 'gpt-4o-mini': false } }),
      ],
      getAvailableModels: () => [],
      formatModelLabel: (_provider: unknown, modelName?: string) => modelName ?? '',
    });

    render(<SummarySection settings={settings()} onChange={vi.fn()} />);

    const picker = (await screen.findByTestId('voice-summary-model-picker')) as HTMLSelectElement;
    const optionValues = Array.from(picker.options).map((option) => option.value);
    expect(optionValues).toContain('gpt-4o');
    expect(optionValues).not.toContain('gpt-4o-mini');
  });
});
