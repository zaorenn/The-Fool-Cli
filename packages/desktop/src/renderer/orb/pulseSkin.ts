/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The quiet orb: three rings and nothing else.
 *
 * Here because a registry with one entry proves nothing. This is the shape a
 * second skin takes — one file, one `draw`, added to `skins.ts` — and having it
 * in from the start is what keeps the contract honest: anything `reactorSkin`
 * reached for that is not in {@link OrbFrame} would show up as this one being
 * unable to do it.
 *
 * It is also genuinely the better choice for some people. The reactor is a lot
 * of movement to have on top of every window all day, and somebody who wants to
 * know the microphone is open without being watched by an instrument should not
 * have to switch the orb off entirely to get it.
 */

import type { OrbFrame, Rgb } from './types';

const rgba = ([r, g, b]: Rgb, alpha: number): string => `rgba(${r}, ${g}, ${b}, ${alpha})`;

export const pulseSkin = {
  id: 'pulse',
  label: 'Pulse',
  about: 'Three soft rings that breathe. Almost still when nothing is happening.',

  draw: ({ ctx, width, height, time, level, palette }: OrbFrame): void => {
    if (width < 4 || height < 4) return;

    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) / 2 - Math.min(width, height) * 0.06;
    const { tint } = palette;

    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    glow.addColorStop(0, rgba(tint, 0.5 + level * 0.28));
    glow.addColorStop(0.5, rgba(tint, 0.14));
    glow.addColorStop(1, rgba(tint, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    // Three rings, each a third of a cycle behind the last, so there is always
    // one arriving and one leaving — a heartbeat rather than a blink.
    for (let ring = 0; ring < 3; ring += 1) {
      const cycle = (((time * 0.00035 + ring / 3) % 1) + 1) % 1;
      const r = radius * (0.28 + cycle * 0.66) * (1 + level * 0.12);
      ctx.strokeStyle = rgba(tint, (1 - cycle) * 0.45);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    const core = radius * (0.2 + level * 0.1);
    ctx.fillStyle = rgba(tint, 0.9);
    ctx.beginPath();
    ctx.arc(cx, cy, core, 0, Math.PI * 2);
    ctx.fill();
  },
};
