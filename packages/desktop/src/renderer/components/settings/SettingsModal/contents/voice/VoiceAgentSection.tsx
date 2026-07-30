/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Select, Switch } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { IProvider } from '@/common/config/storage';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { isAionrsAssistant } from '@/common/types/agent/assistantTypes';
import type { FoolVoiceSettings } from '@/common/types/foolVoice';
import { useManagedAgentRuntimeCatalog } from '@renderer/hooks/agent/useManagedAgents';
import { buildAgentRuntimeModelInfo } from '@renderer/utils/model/agentRuntimeCatalog';

export type VoiceAgentSectionProps = {
  settings: FoolVoiceSettings;
  onChange: (change: (previous: FoolVoiceSettings) => FoolVoiceSettings) => void;
};

/**
 * Composite value for the model select, since a model name alone is ambiguous:
 * the same name can live behind two providers with different keys.
 *
 * Split on the first separator only — a model name may well contain one, a
 * provider id will not.
 */
const MODEL_VALUE_SEPARATOR = '::';

const modelValue = (providerId: string, modelId: string): string => `${providerId}${MODEL_VALUE_SEPARATOR}${modelId}`;

const parseModelValue = (value: string): { providerId: string; modelId: string } => {
  const at = value.indexOf(MODEL_VALUE_SEPARATOR);
  if (at < 0) return { providerId: '', modelId: '' };
  return { providerId: value.slice(0, at), modelId: value.slice(at + MODEL_VALUE_SEPARATOR.length) };
};

/**
 * The agent and model that answer when the wake word is heard.
 *
 * Without this a spoken turn inherits whatever the home page was last pointed at,
 * which is fine when you are sitting in front of it and wrong when you are
 * talking to a pet across the room. Pinned here, the same agent and the same
 * model answer every time.
 */
const VoiceAgentSection: React.FC<VoiceAgentSectionProps> = ({ settings, onChange }) => {
  const { t } = useTranslation();
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [providers, setProviders] = useState<IProvider[]>([]);
  const managedAgents = useManagedAgentRuntimeCatalog();

  useEffect(() => {
    let active = true;

    void Promise.all([
      ipcBridge.assistants.list.invoke().catch((): Assistant[] => []),
      ipcBridge.mode.listProviders.invoke().catch((): IProvider[] => []),
    ]).then(([assistantList, providerList]) => {
      if (!active) return;
      setAssistants(assistantList ?? []);
      setProviders(providerList ?? []);
    });

    return () => {
      active = false;
    };
  }, []);

  const assistantOptions = useMemo(
    () => [
      { label: t('settings.voice.agentInherit'), value: '' },
      ...assistants
        .filter((assistant) => assistant.enabled)
        .map((assistant) => ({ label: assistant.name, value: assistant.id })),
    ],
    [assistants, t]
  );

  const selectedAssistant = assistants.find((assistant) => assistant.id === settings.session.assistantId);
  // The Aion CLI backend is handed the provider record itself, so it cannot fall
  // back to an assistant default the way an ACP agent can.
  const modelRequired = Boolean(selectedAssistant && isAionrsAssistant(selectedAssistant));

  /**
   * The models the selected ACP agent runs, as it names them.
   *
   * Read from the agent's own runtime catalog rather than from AionUi's
   * providers, because the two use different namespaces for the same weights:
   * Hermes calls the LM Studio model `lmstudio:qwen/qwen3.5-9b` and the provider
   * calls it `qwen/qwen3.5-9b`. Offering the provider's spelling here produced a
   * pin the agent could not resolve, so it quietly answered on its own default.
   */
  const agentOwnModels = useMemo(() => {
    const agent = selectedAssistant?.agent_id
      ? managedAgents.find((candidate) => candidate.id === selectedAssistant.agent_id)
      : undefined;
    const runtime = buildAgentRuntimeModelInfo(agent);
    if (runtime) return runtime.available_models.map((model) => ({ id: model.id, label: model.label }));
    return (selectedAssistant?.models ?? []).map((model) => ({ id: model, label: model }));
  }, [managedAgents, selectedAssistant]);

  const modelOptions = useMemo(() => {
    const inherit = { label: t('settings.voice.modelInherit'), value: modelValue('', '') };
    // An agent that carries its own models takes only those; a provider id would
    // be meaningless to it, so the pair is stored with the provider left empty.
    if (!modelRequired && agentOwnModels.length > 0) {
      return [inherit, ...agentOwnModels.map((model) => ({ label: model.label, value: modelValue('', model.id) }))];
    }

    return [
      inherit,
      ...providers.flatMap((provider) =>
        (provider.models ?? [])
          .filter((model) => provider.model_enabled?.[model] !== false)
          .map((model) => ({
            label: `${model} · ${provider.name}`,
            value: modelValue(provider.id, model),
          }))
      ),
    ];
  }, [agentOwnModels, modelRequired, providers, t]);

  const modelMissing = modelRequired && settings.session.modelId.length === 0;
  const pinnedAgentGone = settings.session.assistantId.length > 0 && assistants.length > 0 && !selectedAssistant;

  return (
    <div className='flex flex-col gap-12px'>
      <label className='flex flex-col gap-4px'>
        <span className='text-13px text-t-secondary'>{t('settings.voice.agent')}</span>
        <Select
          data-testid='voice-agent'
          value={settings.session.assistantId}
          options={assistantOptions}
          onChange={(value: string) =>
            onChange((previous) => ({
              ...previous,
              session: { ...previous.session, assistantId: value },
            }))
          }
        />
      </label>

      <label className='flex flex-col gap-4px'>
        <span className='text-13px text-t-secondary'>{t('settings.voice.agentModel')}</span>
        <Select
          data-testid='voice-agent-model'
          value={modelValue(settings.session.providerId, settings.session.modelId)}
          options={modelOptions}
          showSearch
          onChange={(value: string) =>
            onChange((previous) => ({
              ...previous,
              session: { ...previous.session, ...parseModelValue(value) },
            }))
          }
        />
      </label>

      <span className='text-12px text-t-secondary'>{t('settings.voice.agentHint')}</span>

      <label className='flex items-center justify-between gap-12px'>
        <span className='text-13px text-t-secondary'>{t('settings.voice.attachScreenshot')}</span>
        <Switch
          data-testid='voice-attach-screenshot'
          checked={settings.session.attachScreenshot}
          onChange={(checked: boolean) =>
            onChange((previous) => ({
              ...previous,
              session: { ...previous.session, attachScreenshot: checked },
            }))
          }
        />
      </label>
      <span className='text-12px text-t-secondary'>{t('settings.voice.attachScreenshotHint')}</span>

      {modelMissing && (
        <span className='text-12px text-warning' data-testid='voice-agent-needs-model'>
          {t('settings.voice.agentNeedsModel')}
        </span>
      )}
      {pinnedAgentGone && (
        <span className='text-12px text-warning' data-testid='voice-agent-missing'>
          {t('settings.voice.agentMissing')}
        </span>
      )}
    </div>
  );
};

export default VoiceAgentSection;
