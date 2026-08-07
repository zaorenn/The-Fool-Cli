/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { Theme } from '@/common/theme/types';
import { defaultLayoutTokens } from '@/common/config/layoutTokens';
import { sanitizeMotions } from '@/common/config/layoutMotions';
import { applyTheme } from '@renderer/utils/theme/applyTheme';
import { applyLayoutTokens } from '@renderer/utils/theme/applyLayoutTokens';
import { applyLayoutMotions } from '@renderer/utils/theme/applyLayoutMotions';

/**
 * A theme arriving without taking the layout with it.
 *
 * Both of these end up as style elements in the same head, so which one wins is
 * decided by source order. A theme is appended last when it is applied, which
 * puts every preset's declaration after the dials the user turned — so choosing
 * a palette would quietly straighten corners somebody had rounded, and a
 * workspace that brings a palette with it would undo its own layout on the way
 * in. That is the exact case the JARVIS workspace is: one choice that moves
 * both.
 */

const jarvisish = (): Theme => ({
  id: 'test-theme',
  name: 'Test',
  appearance: 'dark',
  css: ':root { --color-bg-1: #05070c; }',
  builtin: true,
  created_at: 0,
  updated_at: 0,
});

const positionOf = (id: string): number =>
  [...document.head.querySelectorAll('style')].findIndex((style) => style.id === id);

describe('applying a theme', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
  });

  it("leaves the user's dials on top of it, not under it", () => {
    applyLayoutTokens({ ...defaultLayoutTokens(), radius: 2, spacing: 20 });
    applyTheme(jarvisish());

    const tokens = positionOf('fool-layout-tokens');
    const decoration = positionOf('theme-decoration');

    expect(tokens).toBeGreaterThan(-1);
    expect(tokens).toBeGreaterThan(decoration);
  });

  it('says which palette is worn, not only whether it is a dark one', () => {
    // A palette that wants motion cannot keep its keyframes in its own
    // stylesheet — every declaration in there is rewritten to `!important`
    // before injection, and an important declaration inside a keyframe is
    // ignored. So the motion lives in an ordinary stylesheet, and that
    // stylesheet has nothing to scope itself by without this.
    applyTheme(jarvisish());

    expect(document.documentElement.getAttribute('data-theme-id')).toBe('test-theme');
  });

  it('leaves a built movement still playing afterwards', () => {
    const motions = sanitizeMotions([
      { target: 'message', move: 'rise', durationMs: 240, distancePx: 12, easing: 'smooth' },
    ]);
    applyLayoutMotions('chat', motions);
    applyTheme(jarvisish());

    const element = document.getElementById('fool-layout-motions-chat');
    expect(element?.textContent ?? '').toContain('@keyframes');
    expect(positionOf('fool-layout-motions-chat')).toBeGreaterThan(positionOf('theme-decoration'));
  });
});
