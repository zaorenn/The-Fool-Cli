/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { Button, Input, Select, Typography } from '@arco-design/web-react';
import { Delete } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import {
  LAYOUT_OPTION_VALUES,
  layoutsForSurface,
  SURFACE_IDS,
  surfaceOptionKeys,
  type LayoutOptionKey,
  type LayoutOptions,
  type SurfaceId,
} from '@/common/config/surfaceLayouts';
import { defaultLayoutTokens, type LayoutTokens } from '@/common/config/layoutTokens';
import type { LayoutMotion } from '@/common/config/layoutMotions';
import type { ImportedLayout } from '@/common/config/layoutImport';
import { useSurfaceLayout } from '@renderer/hooks/config/useSurfaceLayout';
import { applyLayoutTokens } from '@renderer/utils/theme/applyLayoutTokens';
import LayoutBrief from './LayoutBrief';
import MotionBuilder from './MotionBuilder';
import TokenEditor from './TokenEditor';

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
  const [tokens, setTokens] = useState<LayoutTokens>(layout.tokens ?? defaultLayoutTokens());
  const [motions, setMotions] = useState<LayoutMotion[]>(layout.motions);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  /** A preset that arrived from outside and must survive the surface changing. */
  const pending = useRef<ImportedLayout | null>(null);

  useEffect(() => {
    // An import that has just landed wins over whatever this surface was
    // wearing. Without this the reload that follows `setSurface` would put the
    // surface's own layout back and the imported one would vanish between two
    // renders, with nothing on screen to say why.
    const imported = pending.current;
    if (imported && imported.surface === layout.surface) {
      pending.current = null;
      return;
    }

    setDraft(layout.options);
    setTokens(layout.tokens ?? defaultLayoutTokens());
    setMotions(layout.motions);
  }, [layout]);

  /**
   * The dials take effect as they are turned, before anything is saved.
   *
   * A slider you have to save to see is a slider nobody uses: you turn it, close
   * the page, look, come back, turn it again. So the app wears the draft while
   * it is being edited, and saving is what gives it a name rather than what
   * makes it real. Reverting is one click on the layout picker.
   */
  const turn = (next: LayoutTokens): void => {
    setTokens(next);
    applyLayoutTokens(next);
  };

  /**
   * A preset that arrived from outside, put in front of the person rather than
   * applied behind them.
   *
   * It lands in the editor as an unsaved draft, with the name it came with in
   * the box — so what a stranger's model produced is looked at, adjusted and
   * kept deliberately. Importing straight into the library would mean a file
   * changing somebody's app before they had seen what was in it.
   */
  const adopt = (imported: ImportedLayout): void => {
    // Held rather than written straight into the draft. Changing the surface
    // reloads the layout for that surface, which runs the effect above and would
    // overwrite everything that just arrived — so the import waits in a slot the
    // effect knows to consume first.
    pending.current = imported;
    setSurface(imported.surface);
    applyImported(imported);
  };

  const applyImported = (imported: ImportedLayout): void => {
    setDraft(imported.options);
    setMotions(imported.motions);
    setName(imported.name);
    turn(imported.tokens);
  };

  const available = layoutsForSurface(surface, presets);
  // Only what this surface answers. Asked twice — once to draw the switches,
  // once to decide whether anything changed — because a difference in a key the
  // surface does not use is not an edit the user made.
  const keys = surfaceOptionKeys(surface);
  const tokensDirty = JSON.stringify(tokens) !== JSON.stringify(layout.tokens ?? defaultLayoutTokens());
  const motionsDirty = JSON.stringify(motions) !== JSON.stringify(layout.motions);
  const dirty = keys.some((key) => draft[key] !== layout.options[key]) || tokensDirty || motionsDirty;

  const commit = async (): Promise<void> => {
    setSaving(true);
    try {
      const saved = await save(name.trim() || t('settings.layout.untitled'), draft, tokens, motions);
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
        {keys.map((key: LayoutOptionKey) => (
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

      {/* The dials, and a real card to watch while they are turned. */}
      <TokenEditor tokens={tokens} onChange={turn} />

      {/* Movements, built by choosing rather than by writing. Saved with the
          layout, so they arrive when it is worn. */}
      <MotionBuilder motions={motions} onChange={setMotions} />

      {/* Or have whichever AI they already use design one, and bring it back. */}
      <LayoutBrief onImported={adopt} />

      {/* Saving is what gives an arrangement a name — the app is already
          wearing it, so the hint says what a name buys rather than implying
          nothing has happened yet. */}
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
