/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { layoutBrief } from '@/common/config/layoutBrief';
import { readLayoutFile } from '@/common/config/layoutImport';

/**
 * Taking back what another AI produced.
 *
 * This is the only place in the app where a file written by an unknown model,
 * for a prompt nobody checked, becomes an interface. Everything here is about
 * that: what it does with a good file, what it does with a plausible-looking bad
 * one, and what it refuses to let the file decide for itself.
 */

const good = JSON.stringify({
  name: 'Oscilloscope',
  surface: 'chat',
  options: { bubbles: 'flat', density: 'compact' },
  tokens: { radius: 0, motionMs: 120 },
  motions: [{ target: 'message', move: 'rise', durationMs: 160, distancePx: 8, easing: 'sharp' }],
});

describe('readLayoutFile', () => {
  it('reads a preset written the way the brief asks for', () => {
    const result = readLayoutFile(good);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.layout.name).toBe('Oscilloscope');
    expect(result.layout.surface).toBe('chat');
    expect(result.layout.options.bubbles).toBe('flat');
    expect(result.layout.tokens.radius).toBe(0);
    expect(result.layout.motions).toHaveLength(1);
  });

  /**
   * The example in the brief has to be a file this app accepts. If those two
   * ever disagree, every person who follows the instructions exactly gets a
   * rejection, and the instructions are the app's own.
   */
  it('accepts the worked example out of the brief itself', () => {
    const fenced = layoutBrief().match(/```json\n([\s\S]*?)\n```/);
    const result = readLayoutFile(fenced?.[1] ?? '');

    expect(result.status).toBe('ok');
  });

  it('copes with the fence a model wraps its answer in', () => {
    expect(readLayoutFile('```json\n' + good + '\n```').status).toBe('ok');
  });

  it('copes with a sentence in front of the JSON, because models say things', () => {
    expect(readLayoutFile('Sure! Here is your preset:\n\n' + good).status).toBe('ok');
  });

  it('names what went wrong instead of doing nothing', () => {
    expect(readLayoutFile('   ')).toEqual({ status: 'failed', reason: 'empty' });
    expect(readLayoutFile('I would be happy to help!')).toEqual({ status: 'failed', reason: 'not-json' });
    expect(readLayoutFile('[1, 2, 3]')).toEqual({ status: 'failed', reason: 'not-a-preset' });
    expect(readLayoutFile('{"name":"X","surface":"cockpit"}')).toEqual({ status: 'failed', reason: 'no-surface' });
    expect(readLayoutFile('{"surface":"chat"}')).toEqual({ status: 'failed', reason: 'no-name' });
  });

  it("drops a value it does not have rather than taking the model's word for it", () => {
    const result = readLayoutFile(
      JSON.stringify({ name: 'X', surface: 'chat', options: { bubbles: 'holographic', density: 'compact' } })
    );

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    // The invented one falls back; the real one beside it still lands.
    expect(result.layout.options.bubbles).toBe('bubbles');
    expect(result.layout.options.density).toBe('compact');
  });

  it('ignores an axis belonging to a different window', () => {
    const result = readLayoutFile(JSON.stringify({ name: 'X', surface: 'hub', options: { sider: 'hidden' } }));

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.layout.options.sider).toBe('left');
  });

  it('clamps a dial a model pushed past the end of its range', () => {
    const result = readLayoutFile(JSON.stringify({ name: 'X', surface: 'chat', tokens: { radius: 9000 } }));

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.layout.tokens.radius).toBeLessThanOrEqual(28);
  });

  it('drops a movement aimed at something that is not a target', () => {
    const result = readLayoutFile(
      JSON.stringify({
        name: 'X',
        surface: 'chat',
        motions: [
          { target: 'everything', move: 'rise', durationMs: 200, distancePx: 8, easing: 'smooth' },
          { target: 'message', move: 'fade', durationMs: 200, distancePx: 0, easing: 'smooth' },
        ],
      })
    );

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.layout.motions).toHaveLength(1);
    expect(result.layout.motions[0].target).toBe('message');
  });

  /**
   * A file cannot promote itself. Claiming to be built in would make a preset
   * nobody can delete, and carrying its own id would let a shared file overwrite
   * something the person made and named.
   */
  it('never lets the file decide that it ships with the app', () => {
    const result = readLayoutFile(JSON.stringify({ name: 'X', surface: 'chat', builtin: true, id: 'instrument' }));

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.layout).not.toHaveProperty('builtin');
    expect(result.layout).not.toHaveProperty('id');
  });

  it('refuses a name that is only whitespace, rather than saving an unnameable preset', () => {
    expect(readLayoutFile('{"name":"   ","surface":"chat"}')).toEqual({ status: 'failed', reason: 'no-name' });
  });
});
