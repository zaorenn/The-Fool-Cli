/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback } from 'react';
import { Button, Input, Slider, Switch } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { VoiceModel, VoiceParams, VoiceParamSpec, VoiceParamValue } from '@/common/types/foolVoice';

export type VoiceParamsSectionProps = {
  /** The voice currently selected, or undefined while the catalog loads. */
  model: VoiceModel | undefined;
  /** Saved values for this model, keyed by the engine's own parameter name. */
  params: VoiceParams;
  onChange: (params: VoiceParams) => void;
};

/**
 * The generation knobs of whichever engine is selected.
 *
 * Built from the schema the model carries rather than from a list kept here, so
 * an engine that gains a parameter gains a control without this file changing —
 * and, more importantly, a control cannot exist for a parameter the request
 * validator would reject, because both read the same declaration.
 *
 * Parameter names are shown exactly as the engine spells them. They are wire
 * identifiers, not prose: `guidance_scale` is what upstream's documentation
 * calls it and what a search for it will find, and translating it would leave
 * the user holding a name that appears nowhere else.
 */
const VoiceParamsSection: React.FC<VoiceParamsSectionProps> = ({ model, params, onChange }) => {
  const { t } = useTranslation();

  const set = useCallback(
    (name: string, value: VoiceParamValue) => onChange({ ...params, [name]: value }),
    [onChange, params]
  );

  const specs: readonly VoiceParamSpec[] = model?.role === 'text-to-speech' && model.paramSpecs ? model.paramSpecs : [];
  if (specs.length === 0) return null;

  // An absent key means "the engine's own default", which is also what an
  // emptied record means — so resetting is a deletion rather than a write of
  // every default back, and an upstream default that changes is followed
  // instead of frozen at whatever it was when this page was last opened.
  const valueOf = (spec: VoiceParamSpec): VoiceParamValue => params[spec.name] ?? spec.default;

  const control = (spec: VoiceParamSpec): React.ReactNode => {
    if (spec.type === 'boolean') {
      const value = valueOf(spec);
      return (
        <Switch
          size='small'
          data-testid={`voice-param-${spec.name}`}
          checked={typeof value === 'boolean' ? value : spec.default}
          onChange={(checked) => set(spec.name, checked)}
        />
      );
    }

    if (spec.type === 'text') {
      const value = valueOf(spec);
      return (
        <Input
          size='small'
          className='max-w-220px'
          data-testid={`voice-param-${spec.name}`}
          maxLength={spec.maxLength}
          value={typeof value === 'string' ? value : spec.default}
          onChange={(next) => set(spec.name, next)}
        />
      );
    }

    const value = valueOf(spec);
    return (
      <Slider
        className='w-220px'
        data-testid={`voice-param-${spec.name}`}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        showInput
        value={typeof value === 'number' ? value : spec.default}
        onChange={(next) => set(spec.name, Array.isArray(next) ? next[0] : next)}
      />
    );
  };

  return (
    <div className='flex flex-col gap-8px mt-16px' data-testid='voice-params'>
      <div className='flex items-center justify-between gap-8px'>
        <span className='text-13px font-500 text-t-primary'>{t('settings.voice.params')}</span>
        <Button
          size='mini'
          data-testid='voice-params-reset'
          disabled={Object.keys(params).length === 0}
          onClick={() => onChange({})}
        >
          {t('settings.voice.paramsReset')}
        </Button>
      </div>
      <span className='text-12px text-t-tertiary'>{t('settings.voice.paramsHint')}</span>

      {specs.map((spec) => (
        <div key={spec.name} className='flex items-center justify-between gap-12px'>
          <span className='text-13px text-t-secondary truncate'>{spec.name}</span>
          {control(spec)}
        </div>
      ))}
    </div>
  );
};

export default VoiceParamsSection;
