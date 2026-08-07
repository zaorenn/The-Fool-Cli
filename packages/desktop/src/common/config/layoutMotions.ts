/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A movement somebody built without knowing what a keyframe is.
 *
 * The app already had an escape hatch for people who wanted the interface to
 * move differently: write a CSS theme. That is not an answer for the person this
 * is for. Somebody who wants a message to rise into place has a picture in their
 * head, not a stylesheet, and asking them to learn `@keyframes` to get it is the
 * same as saying no.
 *
 * So a movement is three choices — what moves, how it moves, how quickly — and
 * this turns those into the CSS. Every combination has to produce something
 * that looks deliberate, which is the reason the lists are short: five things
 * that can move and six ways to move are enough to describe what people
 * actually ask for, and few enough that all thirty were worth looking at.
 *
 * Closed by construction, and that matters more here than anywhere else in the
 * layout system. This is the one place a stored preference becomes the text of a
 * `<style>` element, so nothing is passed through: targets and moves are matched
 * against known lists, numbers are clamped, and the identifier used to name a
 * keyframe is rebuilt from scratch rather than taken as given. A preset can
 * arrive from an imported workspace, which is to say from someone else.
 *
 * Shared by main and renderer, so no DOM here. This produces the text; putting
 * it on the page is the renderer's job.
 */

import type { SurfaceId } from './surfaceLayouts';

/** The things that can be made to move. */
export const MOTION_TARGETS = ['message', 'card', 'sider', 'titlebar', 'button'] as const;

export type MotionTarget = (typeof MOTION_TARGETS)[number];

/** The ways something can arrive. */
export const MOTION_MOVES = ['fade', 'rise', 'fall', 'in-from-left', 'in-from-right', 'pop'] as const;

export type MotionMove = (typeof MOTION_MOVES)[number];

/** How the movement is paced. */
export const MOTION_EASINGS = ['smooth', 'sharp', 'spring'] as const;

export type MotionEasing = (typeof MOTION_EASINGS)[number];

export type LayoutMotion = {
  /** Built from the target and move, never taken from stored text. */
  id: string;
  target: MotionTarget;
  move: MotionMove;
  /** Milliseconds. Zero is allowed and means "arrive already there". */
  durationMs: number;
  /** How far it travels, for the moves that travel. */
  distancePx: number;
  easing: MotionEasing;
};

/** The most a preset may carry. A page with forty animations is a page nobody can read. */
export const MAX_MOTIONS = 12;

const MAX_DURATION_MS = 2000;
const MAX_DISTANCE_PX = 64;

/**
 * Where each target actually lives in the markup.
 *
 * A mixture of classes and attributes because the app is a mixture: some of
 * these are already stable handles the app maintains for its own reasons, and
 * inventing a parallel one for them would leave two names for one element. The
 * Hub's card gets an attribute because its class is hashed by CSS Modules and
 * cannot be named from outside the module.
 */
export const MOTION_TARGET_SELECTOR: Record<MotionTarget, string> = {
  message: '.chat-message-body',
  card: "[data-fool-target='card']",
  sider: '.layout-sider',
  titlebar: '.app-titlebar',
  button: '.arco-btn',
};

/** Which surface a target belongs to, so a movement is suppressed with the right one. */
export const MOTION_TARGET_SURFACE: Record<MotionTarget, SurfaceId> = {
  message: 'chat',
  card: 'hub',
  sider: 'frame',
  titlebar: 'frame',
  button: 'frame',
};

const EASING_CURVE: Record<MotionEasing, string> = {
  smooth: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
  sharp: 'cubic-bezier(0.4, 0, 0.2, 1)',
  // Overshoots and settles. The one people mean when they say "bouncy".
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
};

/** The starting state of each move. The end state is always "as designed". */
const openingFrame = (move: MotionMove, distance: number): string => {
  switch (move) {
    case 'fade':
      return 'opacity: 0;';
    case 'rise':
      return `opacity: 0; transform: translateY(${distance}px);`;
    case 'fall':
      return `opacity: 0; transform: translateY(-${distance}px);`;
    case 'in-from-left':
      return `opacity: 0; transform: translateX(-${distance}px);`;
    case 'in-from-right':
      return `opacity: 0; transform: translateX(${distance}px);`;
    case 'pop':
      return 'opacity: 0; transform: scale(0.94);';
  }
};

const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
};

/**
 * The name a keyframe is given.
 *
 * Built from values already proven to be members of a fixed list, plus the
 * motion's position. Nothing a user or an imported file wrote reaches this, so
 * there is no arrangement of stored text that can end a rule early and start
 * one of its own.
 */
const motionId = (target: MotionTarget, move: MotionMove, index: number): string => `${target}-${move}-${index}`;

export const sanitizeMotions = (value: unknown): LayoutMotion[] => {
  if (!Array.isArray(value)) return [];

  const motions: LayoutMotion[] = [];

  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue;
    const record = raw as Record<string, unknown>;

    const target = MOTION_TARGETS.find((entry) => entry === record.target);
    const move = MOTION_MOVES.find((entry) => entry === record.move);
    // A movement aimed at nothing, or moving in a way this version does not
    // have, is dropped rather than repaired: any repair would be inventing an
    // animation the user did not ask for.
    if (!target || !move) continue;

    const easing = MOTION_EASINGS.find((entry) => entry === record.easing) ?? 'smooth';

    motions.push({
      id: motionId(target, move, motions.length),
      target,
      move,
      // Clamped rather than dropped. These came off sliders, and a slider that
      // silently deletes the thing it is adjusting is worse than one that stops.
      durationMs: clamp(record.durationMs, 0, MAX_DURATION_MS, 240),
      distancePx: clamp(record.distancePx, 0, MAX_DISTANCE_PX, 12),
      easing,
    });

    if (motions.length >= MAX_MOTIONS) break;
  }

  return motions;
};

/**
 * The stylesheet a set of built movements amounts to.
 *
 * Guarded twice. `:not([data-fool-<surface>-motion='none'])` is the app's own
 * stillness setting, and the reduced-motion query is the operating system's —
 * somebody who has told their computer they do not want interfaces moving has
 * said something that outranks a movement they built earlier, or that arrived
 * inside somebody else's workspace.
 */
export const motionStylesheet = (surface: SurfaceId, motions: readonly LayoutMotion[]): string => {
  if (motions.length === 0) return '';

  const blocks = motions.map((motion) => {
    const name = `fool-motion-${motion.id}`;
    const selector = MOTION_TARGET_SELECTOR[motion.target];
    const guard = `html:not([data-fool-${surface}-motion='none'])`;

    return [
      `@keyframes ${name} { from { ${openingFrame(motion.move, motion.distancePx)} } to { opacity: 1; transform: none; } }`,
      `${guard} ${selector} { animation: ${name} ${motion.durationMs}ms ${EASING_CURVE[motion.easing]} both; }`,
    ].join('\n');
  });

  return [
    '@media not (prefers-reduced-motion: reduce) {',
    blocks.join('\n\n'),
    '}',
    '',
    '/* Asked for less motion: the movements exist, they simply do not play. */',
    '@media (prefers-reduced-motion: reduce) {',
    motions.map((motion) => `${MOTION_TARGET_SELECTOR[motion.target]} { animation: none; }`).join('\n'),
    '}',
  ].join('\n');
};
