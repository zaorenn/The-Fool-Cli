/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Button, Input, Select, Typography } from '@arco-design/web-react';
import { Delete } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import {
  LAYOUT_OPTION_KEYS,
  LAYOUT_OPTION_VALUES,
  layoutsForSurface,
  SURFACE_IDS,
  type LayoutOptionKey,
  type LayoutOptions,
  type SurfaceId,
} from '@/common/config/surfaceLayouts';
import { useSurfaceLayout } from '@renderer/hooks/config/useSurfaceLayout';

/**
 * Choosing what shape a window is, and keeping the one you built.
 *
 * Sits under the theme pickers because it answers the neighbouring question: the
 * theme decides what the app is coloured like everywhere, this decides what one
 * window is laid out like. Someone can want The Fool's crimson throughout and
 * still want the voice page to be a dial rather than a column, and one setting
 * answering both would mean taking a look you did not want to get a shape you
 * did.
 *
 * A layout is a handful of named decisions rather than a canvas. That is the
 * honest limit of it: every combination of these has to work, which is only
 * true because there are few enough of them to have thought about.
 */

const LayoutCustomizer: React.FC = () => {
  const { t } = useTranslation();
  const [surface, setSurface] = useState<SurfaceId>('voice');
  const { layout, presets, wear, save, remove } = useSurfaceLayout(surface);

  /**
   * The options being edited, which are not always the ones in force.
   *
   * Changing a knob on a built-in must not rewrite the built-in — it is the
   * starting point for one of yours. So edits live here until they are saved
   * under a name, and a built-in stays exactly as it shipped.
   */
  const [draft, setDraft] = useState<LayoutOptions>(layout.options);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(layout.options);
  }, [layout]);

  const available = layoutsForSurface(surface, presets);
  const dirty = LAYOUT_OPTION_KEYS.some((key) => draft[key] !== layout.options[key]);

  const commit = async (): Promise<void> => {
    setSaving(true);
    try {
      const saved = await save(name.trim() || t('settings.layout.untitled'), draft);
      if (saved) setName('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='grid gap-16px'>
      <div className='grid gap-4px'>
        <Typography.Title heading={6} className='!mb-0 !text-t-primary'>
          {t('settings.layout.title')}
        </Typography.Title>
        <Typography.Text className='text-12px leading-19px text-t-tertiary'>
          {t('settings.layout.subtitle')}
        </Typography.Text>
      </div>

      <div className='grid grid-cols-2 gap-12px max-[560px]:grid-cols-1'>
        <label className='grid gap-5px'>
          <Typography.Text className='text-12px font-600 text-t-secondary'>
            {t('settings.layout.surface')}
          </Typography.Text>
          <Select
            value={surface}
            onChange={(value: SurfaceId) => setSurface(value)}
            options={SURFACE_IDS.map((id) => ({ label: t(`settings.layout.surfaceName.${id}`), value: id }))}
          />
        </label>

        <label className='grid gap-5px'>
          <Typography.Text className='text-12px font-600 text-t-secondary'>
            {t('settings.layout.wearing')}
          </Typography.Text>
          <Select
            data-testid='layout-picker'
            value={layout.id}
            onChange={(value: string) => void wear(value)}
            options={available.map((preset) => ({
              label: preset.builtin
                ? t(`settings.layout.presetName.${preset.id}`, { defaultValue: preset.name })
                : preset.name,
              value: preset.id,
            }))}
          />
        </label>
      </div>

      <div className='grid grid-cols-2 gap-12px max-[560px]:grid-cols-1'>
        {LAYOUT_OPTION_KEYS.map((key: LayoutOptionKey) => (
          <label key={key} className='grid gap-5px'>
            <Typography.Text className='text-12px font-600 text-t-secondary'>
              {t(`settings.layout.option.${key}`)}
            </Typography.Text>
            <Select
              data-testid={`layout-option-${key}`}
              value={draft[key]}
              onChange={(value: string) => setDraft((previous) => ({ ...previous, [key]: value }))}
              options={(LAYOUT_OPTION_VALUES[key] as readonly string[]).map((value) => ({
                label: t(`settings.layout.value.${key}.${value}`),
                value,
              }))}
            />
          </label>
        ))}
      </div>

      {/* Saving is how an edit takes effect, so the hint says so plainly rather
          than leaving someone to wonder why the page has not moved. */}
      <div className='grid gap-6px rounded-8px bg-fill-1 px-12px py-10px'>
        <Typography.Text className='text-11px leading-16px text-t-tertiary'>
          {dirty ? t('settings.layout.saveHint') : t('settings.layout.editHint')}
        </Typography.Text>
        <div className='flex flex-wrap items-center gap-8px'>
          <Input
            className='max-w-220px'
            value={name}
            maxLength={48}
            placeholder={t('settings.layout.namePlaceholder')}
            onChange={setName}
          />
          <Button
            type='primary'
            size='small'
            loading={saving}
            disabled={!dirty && name.trim().length === 0}
            onClick={() => void commit()}
          >
            {t('settings.layout.save')}
          </Button>
        </div>
      </div>

      {available.some((preset) => !preset.builtin) ? (
        <div className='grid gap-6px'>
          <Typography.Text className='text-12px font-600 text-t-secondary'>
            {t('settings.layout.yours')}
          </Typography.Text>
          <div className='flex flex-wrap gap-8px'>
            {available
              .filter((preset) => !preset.builtin)
              .map((preset) => (
                <span key={preset.id} className='flex items-center gap-4px rounded-6px bg-fill-1 py-4px pl-10px pr-4px'>
                  <button
                    type='button'
                    className='cursor-pointer border-0 bg-transparent text-12px text-t-primary'
                    onClick={() => void wear(preset.id)}
                  >
                    {preset.name}
                  </button>
                  <Button
                    type='text'
                    size='mini'
                    icon={<Delete size={13} />}
                    aria-label={t('common.delete')}
                    onClick={() => void remove(preset.id)}
                  />
                </span>
              ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default LayoutCustomizer;
