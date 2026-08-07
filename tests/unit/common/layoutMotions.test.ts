/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_MOTIONS,
  MOTION_MOVES,
  MOTION_TARGETS,
  motionStylesheet,
  sanitizeMotions,
  type LayoutMotion,
} from '@/common/config/layoutMotions';

/**
 * A movement somebody built without writing any CSS.
 *
 * The point of this is that the person using it does not know what a keyframe
 * is. They said "a message should come up from below, quickly" by choosing three
 * things from three lists, and everything after that is this module's problem.
 *
 * So the rules here are about what a *choice* is allowed to become. A stored
 * motion is user input that ends up as a stylesheet, which makes it the one
 * place in the layout system where a bad value could do more than look wrong —
 * it could put arbitrary text in a `<style>` element. Every field is therefore
 * closed: named targets, named moves, clamped numbers, and an identifier that is
 * built rather than accepted.
 */

const motion = (over: Partial<LayoutMotion> = {}): unknown => ({
  id: 'a',
  target: 'message',
  move: 'rise',
  durationMs: 240,
  distancePx: 12,
  easing: 'smooth',
  ...over,
});

describe('sanitizeMotions', () => {
  it('keeps a motion whose every field is one this version knows', () => {
    const kept = sanitizeMotions([motion()]);

    expect(kept).toHaveLength(1);
    expect(kept[0].target).toBe('message');
    expect(kept[0].move).toBe('rise');
  });

  it('drops a motion aimed at something that is not a target', () => {
    expect(sanitizeMotions([motion({ target: 'body' as LayoutMotion['target'] })])).toHaveLength(0);
  });

  it('drops a motion whose movement is not one of the moves', () => {
    expect(sanitizeMotions([motion({ move: 'explode' as LayoutMotion['move'] })])).toHaveLength(0);
  });

  it('clamps a duration rather than dropping the motion, because a slider cannot say why', () => {
    expect(sanitizeMotions([motion({ durationMs: 99_999 })])[0].durationMs).toBeLessThanOrEqual(2000);
    expect(sanitizeMotions([motion({ durationMs: -5 })])[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('refuses anything that is not a list', () => {
    expect(sanitizeMotions('slide' as unknown)).toEqual([]);
    expect(sanitizeMotions(null)).toEqual([]);
  });

  it('keeps a library bounded', () => {
    const many = Array.from({ length: MAX_MOTIONS + 6 }, (_unused, index) => motion({ id: `m${index}` }));
    expect(sanitizeMotions(many).length).toBeLessThanOrEqual(MAX_MOTIONS);
  });
});

describe('motionStylesheet', () => {
  it('is empty when nothing was built, so a person who never opened it gets no rules', () => {
    expect(motionStylesheet('chat', [])).toBe('');
  });

  it('emits a keyframe and a rule for a movement', () => {
    const css = motionStylesheet('chat', sanitizeMotions([motion()]));

    expect(css).toContain('@keyframes');
    expect(css).toContain('animation');
    expect(css).toContain('240ms');
  });

  it("aims at the target's real handle rather than at a name", () => {
    const css = motionStylesheet('chat', sanitizeMotions([motion({ target: 'message' })]));
    expect(css).toContain('.chat-message-body');
  });

  it('does not run when the surface was set to still', () => {
    const css = motionStylesheet('chat', sanitizeMotions([motion()]));
    expect(css).toContain(":not([data-fool-chat-motion='none'])");
  });

  it('yields to someone who asked the system for less motion', () => {
    const css = motionStylesheet('chat', sanitizeMotions([motion()]));
    expect(css).toContain('prefers-reduced-motion');
  });

  it('cannot be made to emit anything but its own identifiers', () => {
    const hostile = sanitizeMotions([motion({ id: 'x; } body { display: none } .y {' })]);

    // Either refused outright, or reduced to a name that is only letters and
    // digits — never the text as given.
    for (const kept of hostile) expect(kept.id).toMatch(/^[a-z0-9-]+$/);
    expect(motionStylesheet('chat', hostile)).not.toContain('display: none');
  });

  it('offers every move it advertises, so no list entry is a dead choice', () => {
    for (const move of MOTION_MOVES) {
      for (const target of MOTION_TARGETS) {
        const css = motionStylesheet('chat', sanitizeMotions([motion({ move, target })]));
        expect(css.length).toBeGreaterThan(0);
      }
    }
  });
});
