/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Switch, Tag } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { FoolVoiceSettings, VoiceSummaryPlanResponse } from '@/common/types/foolVoice';

export type SummarySectionProps = {
  settings: FoolVoiceSettings;
  onChange: (change: (previous: FoolVoiceSettings) => FoolVoiceSettings) => void;
};

/**
 * The switch that decides whether the voice speaks a briefing or the reply.
 *
 * On by default, and it says which model would do the work rather than leaving
 * that to be discovered: a briefing produced by a model that has to be loaded
 * first is slow on its first use, and a machine with no local model at all falls
 * back to reading the reply as written. Both are stated here so neither is a
 * surprise the first time the pet answers.
 */
const SummarySection: React.FC<SummarySectionProps> = ({ settings, onChange }) => {
  const { t } = useTranslation();
  const [plan, setPlan] = useState<VoiceSummaryPlanResponse | null>(null);
  const [checking, setChecking] = useState(false);

  const enabled = settings.summary.translateToEnglish;

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      const response = await ipcBridge.foolVoice.summaryPlan.invoke({
        version: 1,
        requestId: `summary-plan-${crypto.randomUUID()}`,
        payload: { modelId: settings.summary.modelId, lastUsedModelId: '' },
      });
      setPlan(response.ok ? response.data : null);
    } catch {
      // Unreachable is the same news as "nothing can summarise": say so below.
      setPlan(null);
    } finally {
      setChecking(false);
    }
  }, [settings.summary.modelId]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  const model = (): React.ReactNode => {
    if (!enabled) return null;
    if (checking) return <span className='text-12px text-t-secondary'>{t('settings.voice.summaryChecking')}</span>;
    if (!plan || plan.modelId.length === 0) {
      return (
        <span className='text-12px text-warning' data-testid='voice-summary-no-model'>
          {t('settings.voice.summaryNoModel')}
        </span>
      );
    }

    return (
      <div className='flex items-center gap-8px flex-wrap'>
        <span className='text-12px text-t-secondary'>{t('settings.voice.summaryModel')}</span>
        <Tag size='small' color={plan.loaded ? 'green' : 'orange'} data-testid='voice-summary-model'>
          {plan.displayName}
        </Tag>
        {!plan.loaded && <span className='text-12px text-t-secondary'>{t('settings.voice.summaryModelCold')}</span>}
      </div>
    );
  };

  return (
    <div className='flex flex-col gap-12px'>
      <label className='flex items-center justify-between gap-12px'>
        <span className='text-13px text-t-secondary'>{t('settings.voice.summaryEnglish')}</span>
        <Switch
          data-testid='voice-summary-enabled'
          checked={enabled}
          onChange={(checked: boolean) =>
            onChange((previous) => ({
              ...previous,
              summary: { ...previous.summary, translateToEnglish: checked },
            }))
          }
        />
      </label>
      <span className='text-12px text-t-secondary'>{t('settings.voice.summaryEnglishHint')}</span>
      {model()}
    </div>
  );
};

export default SummarySection;
