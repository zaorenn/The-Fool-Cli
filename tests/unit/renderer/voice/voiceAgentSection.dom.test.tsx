/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProvider } from '@/common/config/storage';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { DEFAULT_FOOL_VOICE_SETTINGS, type FoolVoiceSettings } from '@/common/types/foolVoice';
import VoiceAgentSection from '@renderer/components/settings/SettingsModal/contents/voice/VoiceAgentSection';

const listAssistants = vi.fn();
const listProviders = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    assistants: { list: { invoke: () => listAssistants() } },
    mode: { listProviders: { invoke: () => listProviders() } },
  },
}));

type Option = { label: string; value: string };

vi.mock('@arco-design/web-react', () => ({
  Select: ({
    value,
    options,
    onChange,
    ...props
  }: { value?: string; options?: Option[]; onChange?: (value: string) => void } & React.ComponentProps<'select'>) => (
    <select value={value} onChange={(event) => onChange?.(event.target.value)} {...props}>
      {(options ?? []).map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  Switch: ({
    checked,
    onChange,
    ...props
  }: { checked?: boolean; onChange?: (value: boolean) => void } & React.ComponentProps<'input'>) => (
    <input type='checkbox' checked={checked} onChange={(event) => onChange?.(event.target.checked)} {...props} />
  ),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const managedAgents = vi.fn<() => unknown[]>();

vi.mock('@renderer/hooks/agent/useManagedAgents', () => ({
  useManagedAgentRuntimeCatalog: () => managedAgents(),
}));

const assistant = (overrides: Partial<Assistant> = {}): Assistant =>
  ({
    id: 'hermes',
    source: 'user',
    name: 'Hermes',
    name_i18n: {},
    description_i18n: {},
    enabled: true,
    sort_order: 0,
    agent_id: 'aionrs',
    agent: { type: 'aionrs', source: 'internal' },
    enabled_skills: [],
    custom_skill_names: [],
    disabled_builtin_skills: [],
    context_i18n: {},
    prompts: [],
    prompts_i18n: {},
    models: [],
    agent_status: 'online',
    team_selectable: true,
    deletable: true,
    ...overrides,
  }) as Assistant;

const provider = (overrides: Partial<IProvider> = {}): IProvider => ({
  id: 'lmstudio',
  platform: 'openai',
  name: 'LM Studio (Local)',
  base_url: 'http://127.0.0.1:1234/v1',
  api_key: 'sk-local',
  models: ['qwen/qwen3.5-9b'],
  ...overrides,
});

const settings = (session: Partial<FoolVoiceSettings['session']> = {}): FoolVoiceSettings => ({
  ...DEFAULT_FOOL_VOICE_SETTINGS,
  session: { ...DEFAULT_FOOL_VOICE_SETTINGS.session, ...session },
});

describe('VoiceAgentSection', () => {
  beforeEach(() => {
    listAssistants.mockReset();
    listProviders.mockReset();
    managedAgents.mockReset();
    listAssistants.mockResolvedValue([assistant()]);
    listProviders.mockResolvedValue([provider()]);
    managedAgents.mockReturnValue([]);
  });

  it('offers the assistants and models the app has', async () => {
    render(<VoiceAgentSection settings={settings()} onChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('Hermes')).toBeTruthy());
    expect(screen.getByText('qwen/qwen3.5-9b · LM Studio (Local)')).toBeTruthy();
  });

  it('offers to inherit from the home page, which is the shipped default', async () => {
    render(<VoiceAgentSection settings={settings()} onChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('settings.voice.agentInherit')).toBeTruthy());
    expect((screen.getByTestId('voice-agent') as HTMLSelectElement).value).toBe('');
  });

  it('leaves out an assistant the user disabled', async () => {
    listAssistants.mockResolvedValue([assistant(), assistant({ id: 'off', name: 'Retired', enabled: false })]);

    render(<VoiceAgentSection settings={settings()} onChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('Hermes')).toBeTruthy());
    expect(screen.queryByText('Retired')).toBeNull();
  });

  it('leaves out a model the user switched off', async () => {
    listProviders.mockResolvedValue([
      provider({ models: ['qwen/qwen3.5-9b', 'gone'], model_enabled: { gone: false } }),
    ]);

    render(<VoiceAgentSection settings={settings()} onChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('qwen/qwen3.5-9b · LM Studio (Local)')).toBeTruthy());
    expect(screen.queryByText('gone · LM Studio (Local)')).toBeNull();
  });

  it('says an Aion CLI agent needs a model, because it cannot start without one', async () => {
    render(<VoiceAgentSection settings={settings({ assistantId: 'hermes' })} onChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('voice-agent-needs-model')).toBeTruthy());
  });

  it('says nothing of the sort for an ACP agent, which has its own model', async () => {
    listAssistants.mockResolvedValue([assistant({ agent: { type: 'claude-code', source: 'builtin' } })]);

    render(<VoiceAgentSection settings={settings({ assistantId: 'hermes' })} onChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('voice-agent')).toBeTruthy());
    expect(screen.queryByTestId('voice-agent-needs-model')).toBeNull();
  });

  it('warns when the pinned agent has been deleted', async () => {
    render(<VoiceAgentSection settings={settings({ assistantId: 'someone-else' })} onChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('voice-agent-missing')).toBeTruthy());
  });

  it('sends the screen by default, and lets that be switched off', async () => {
    const onChange = vi.fn();
    render(<VoiceAgentSection settings={settings()} onChange={onChange} />);

    const toggle = screen.getByTestId('voice-attach-screenshot') as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    fireEvent.click(toggle);

    const change = onChange.mock.calls[0][0] as (previous: FoolVoiceSettings) => FoolVoiceSettings;
    expect(change(settings()).session.attachScreenshot).toBe(false);
  });

  // Hermes calls the LM Studio model `lmstudio:qwen/qwen3.5-9b`; the provider
  // calls the same weights `qwen/qwen3.5-9b`. Offering the provider's spelling
  // produced a pin the agent could not resolve, so it answered on its default.
  const hermes = () => assistant({ agent_id: '55f3ed1c', agent: { type: 'hermes', source: 'builtin' } });
  const hermesCatalog = [
    {
      id: '55f3ed1c',
      available_models: {
        current_model_id: 'nous:poolside/laguna-s-2.1:free',
        available_models: [{ id: 'lmstudio:qwen/qwen3.5-9b', label: 'LM Studio · qwen/qwen3.5-9b' }],
      },
    },
  ];

  it("offers an ACP agent's own models rather than the app's provider models", async () => {
    listAssistants.mockResolvedValue([hermes()]);
    managedAgents.mockReturnValue(hermesCatalog);

    render(<VoiceAgentSection settings={settings({ assistantId: 'hermes' })} onChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('LM Studio · qwen/qwen3.5-9b')).toBeTruthy());
    expect(screen.queryByText('qwen/qwen3.5-9b · LM Studio (Local)')).toBeNull();
  });

  it("stores an ACP model with no provider, because the agent's id is the whole address", async () => {
    const onChange = vi.fn();
    listAssistants.mockResolvedValue([hermes()]);
    managedAgents.mockReturnValue(hermesCatalog);

    render(<VoiceAgentSection settings={settings({ assistantId: 'hermes' })} onChange={onChange} />);

    await waitFor(() => expect(screen.getByText('LM Studio · qwen/qwen3.5-9b')).toBeTruthy());
    fireEvent.change(screen.getByTestId('voice-agent-model'), {
      target: { value: '::lmstudio:qwen/qwen3.5-9b' },
    });

    const change = onChange.mock.calls[0][0] as (previous: FoolVoiceSettings) => FoolVoiceSettings;
    expect(change(settings()).session).toMatchObject({ providerId: '', modelId: 'lmstudio:qwen/qwen3.5-9b' });
  });

  it('stores the provider alongside the model, since a model name alone is ambiguous', async () => {
    const onChange = vi.fn();
    render(
      <VoiceAgentSection
        settings={settings({ assistantId: 'hermes', providerId: 'lmstudio', modelId: 'qwen/qwen3.5-9b' })}
        onChange={onChange}
      />
    );

    await waitFor(() => expect(screen.getByTestId('voice-agent-model')).toBeTruthy());
    expect((screen.getByTestId('voice-agent-model') as HTMLSelectElement).value).toBe('lmstudio::qwen/qwen3.5-9b');
  });
});
