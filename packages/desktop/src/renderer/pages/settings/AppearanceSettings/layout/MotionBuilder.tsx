/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Button, Select, Slider, Typography } from '@arco-design/web-react';
import { Delete, Play } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import {
  MAX_MOTIONS,
  MOTION_EASINGS,
  MOTION_MOVES,
  MOTION_TARGETS,
  type LayoutMotion,
  type MotionEasing,
  type MotionMove,
  type MotionTarget,
} from '@/common/config/layoutMotions';
import styles from './MotionBuilder.module.css';

/**
 * Building a movement without writing any CSS.
 *
 * Three questions in the order somebody actually thinks of them — what moves,
 * how does it arrive, how quickly — and nothing else on screen. The person this
 * is for does not know what a keyframe is and should not have to; if this asked
 * for an easing curve in the notation CSS uses, it would be a worse version of
 * the CSS theme editor that already exists.
 *
 * Every built movement gets a preview that plays it on a real element rather
 * than describing it. "Spring, 320ms, twelve pixels" is not something anybody
 * can picture, and a person who cannot picture the result cannot tell whether
 * they got what they wanted.
 */

const DEFAULT_DRAFT: Omit<LayoutMotion, 'id'> = {
  target: 'message',
  move: 'rise',
  durationMs: 240,
  distancePx: 12,
  easing: 'smooth',
};

/** The moves that go somewhere, and so have a distance worth setting. */
const TRAVELS: readonly MotionMove[] = ['rise', 'fall', 'in-from-left', 'in-from-right'];

/**
 * The preview keyframe each move plays.
 *
 * Spelled out rather than derived from the move's name, so a move whose name has
 * a dash in it does not depend on how the bundler chooses to export a dashed
 * identifier. Exhaustive by its type: adding a move to `MOTION_MOVES` without a
 * preview to go with it stops compiling here rather than shipping a control that
 * previews nothing.
 */
const PREVIEW_KEYFRAME: Record<MotionMove, string> = {
  fade: styles.moveFade,
  rise: styles.moveRise,
  fall: styles.moveFall,
  'in-from-left': styles.moveInFromLeft,
  'in-from-right': styles.moveInFromRight,
  pop: styles.movePop,
};

const EASING_CURVE: Record<MotionEasing, string> = {
  smooth: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
  sharp: 'cubic-bezier(0.4, 0, 0.2, 1)',
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
};

export type MotionBuilderProps = {
  motions: readonly LayoutMotion[];
  onChange: (motions: LayoutMotion[]) => void;
};

const MotionBuilder: React.FC<MotionBuilderProps> = ({ motions, onChange }) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Omit<LayoutMotion, 'id'>>(DEFAULT_DRAFT);
  /** Bumped to restart the preview animation, which otherwise plays only once. */
  const [previewRun, setPreviewRun] = useState(0);

  const full = motions.length >= MAX_MOTIONS;
  const travels = TRAVELS.includes(draft.move);

  const add = (): void => {
    if (full) return;
    // The id is rebuilt on the way into storage, so anything here is a
    // placeholder rather than a value that has to be right.
    onChange([...motions, { ...draft, id: `${draft.target}-${draft.move}-${motions.length}` }]);
  };

  const previewStyle: React.CSSProperties = {
    animationName: PREVIEW_KEYFRAME[draft.move],
    animationDuration: `${draft.durationMs}ms`,
    animationTimingFunction: EASING_CURVE[draft.easing],
    animationFillMode: 'both',
    // A travelling move needs to know how far, and the keyframes read it here so
    // one set of them serves every distance.
    ['--fool-motion-distance' as string]: `${draft.distancePx}px`,
  };

  return (
    <div className='grid gap-12px'>
      <div className='grid gap-4px'>
        <Typography.Title heading={6} className='!mb-0 !text-t-primary'>
          {t('settings.layout.motion.title')}
        </Typography.Title>
        <Typography.Text className='text-12px leading-19px text-t-tertiary'>
          {t('settings.layout.motion.subtitle')}
        </Typography.Text>
      </div>

      <div className='grid grid-cols-3 gap-12px max-[560px]:grid-cols-1'>
        <label className='grid gap-5px'>
          <Typography.Text className='text-12px font-600 text-t-secondary'>
            {t('settings.layout.motion.what')}
          </Typography.Text>
          <Select
            data-testid='motion-target'
            value={draft.target}
            onChange={(value: MotionTarget) => setDraft((previous) => ({ ...previous, target: value }))}
            options={MOTION_TARGETS.map((target) => ({
              label: t(`settings.layout.motion.target.${target}`),
              value: target,
            }))}
          />
        </label>

        <label className='grid gap-5px'>
          <Typography.Text className='text-12px font-600 text-t-secondary'>
            {t('settings.layout.motion.how')}
          </Typography.Text>
          <Select
            data-testid='motion-move'
            value={draft.move}
            onChange={(value: MotionMove) => setDraft((previous) => ({ ...previous, move: value }))}
            options={MOTION_MOVES.map((move) => ({ label: t(`settings.layout.motion.move.${move}`), value: move }))}
          />
        </label>

        <label className='grid gap-5px'>
          <Typography.Text className='text-12px font-600 text-t-secondary'>
            {t('settings.layout.motion.pacing')}
          </Typography.Text>
          <Select
            data-testid='motion-easing'
            value={draft.easing}
            onChange={(value: MotionEasing) => setDraft((previous) => ({ ...previous, easing: value }))}
            options={MOTION_EASINGS.map((easing) => ({
              label: t(`settings.layout.motion.easing.${easing}`),
              value: easing,
            }))}
          />
        </label>
      </div>

      <div className='grid grid-cols-2 gap-16px max-[560px]:grid-cols-1'>
        <label className='grid gap-4px'>
          <Typography.Text className='text-12px font-600 text-t-secondary'>
            {t('settings.layout.motion.speed', { ms: draft.durationMs })}
          </Typography.Text>
          <Slider
            value={draft.durationMs}
            min={0}
            max={1200}
            step={20}
            onChange={(value) =>
              setDraft((previous) => ({
                ...previous,
                durationMs: typeof value === 'number' ? value : previous.durationMs,
              }))
            }
          />
        </label>

        {/* Only for the moves that travel. A distance slider next to "fade"
            would be a control with nothing on the other end of it. */}
        {travels ? (
          <label className='grid gap-4px'>
            <Typography.Text className='text-12px font-600 text-t-secondary'>
              {t('settings.layout.motion.distance', { px: draft.distancePx })}
            </Typography.Text>
            <Slider
              value={draft.distancePx}
              min={0}
              max={64}
              step={2}
              onChange={(value) =>
                setDraft((previous) => ({
                  ...previous,
                  distancePx: typeof value === 'number' ? value : previous.distancePx,
                }))
              }
            />
          </label>
        ) : null}
      </div>

      {/* Watch it, rather than read about it. */}
      <div className={styles.stage}>
        <div key={previewRun} className={styles.sample} style={previewStyle}>
          {t('settings.layout.motion.sample')}
        </div>
        <Button
          size='small'
          icon={<Play size={13} />}
          onClick={() => setPreviewRun((run) => run + 1)}
          aria-label={t('settings.layout.motion.replay')}
        >
          {t('settings.layout.motion.replay')}
        </Button>
      </div>

      <div className='flex flex-wrap items-center gap-8px'>
        <Button type='primary' size='small' disabled={full} onClick={add}>
          {t('settings.layout.motion.add')}
        </Button>
        {full ? (
          <Typography.Text className='text-11px text-t-tertiary'>
            {t('settings.layout.motion.full', { count: MAX_MOTIONS })}
          </Typography.Text>
        ) : null}
      </div>

      {motions.length > 0 ? (
        <div className='grid gap-6px'>
          <Typography.Text className='text-12px font-600 text-t-secondary'>
            {t('settings.layout.motion.built')}
          </Typography.Text>
          <div className='flex flex-wrap gap-8px'>
            {motions.map((motion, index) => (
              <span
                key={`${motion.id}-${index}`}
                className='flex items-center gap-4px rounded-6px bg-fill-1 py-4px pl-10px pr-4px'
              >
                <Typography.Text className='text-12px text-t-primary'>
                  {t('settings.layout.motion.summary', {
                    what: t(`settings.layout.motion.target.${motion.target}`),
                    how: t(`settings.layout.motion.move.${motion.move}`),
                    ms: motion.durationMs,
                  })}
                </Typography.Text>
                <Button
                  type='text'
                  size='mini'
                  icon={<Delete size={13} />}
                  aria-label={t('common.delete')}
                  onClick={() => onChange(motions.filter((_entry, at) => at !== index))}
                />
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default MotionBuilder;
