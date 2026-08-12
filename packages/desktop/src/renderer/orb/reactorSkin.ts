/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The default orb: an instrument, lit from inside.
 *
 * A bezel of sixty ticks, two counter-rotating arcs with bright leading caps, a
 * faceted iris that breathes with the microphone, a radar sweep and four
 * reticle marks. What makes it read as a machine rather than as a glow is that
 * every part is *aimed at something* — the ticks are a scale, the caps are a
 * position, the reticle is a target — and none of it is decoration that could
 * be moved a few pixels without anybody noticing.
 *
 * Written as one `draw` against {@link OrbFrame}, which is the whole point of
 * the contract: a second look is a second file beside this one, added to
 * `skins.ts`, and nothing else in the application changes.
 *
 * Canvas rather than SVG because this is a continuous field redrawn per frame,
 * not a shape that persists. Hand-authored path data could not express the
 * sweep, and a stack of blurred elements would cost a layout pass a frame in a
 * window that is always on top of everything the user is doing.
 */

import type { OrbFrame, Rgb } from './types';

/** How fast each stage turns, relative to the base rate. */
const SPIN: Record<string, number> = {
  off: 0.18,
  listening: 0.55,
  hearing: 0.8,
  processing: 1.35,
  generating: 1.35,
  speaking: 0.75,
};

const rgba = ([r, g, b]: Rgb, alpha: number): string => `rgba(${r}, ${g}, ${b}, ${alpha})`;

export const reactorSkin = {
  id: 'reactor',
  label: 'Reactor',
  about: 'A bezel, two arcs and an iris that breathes with your voice.',

  draw: ({ ctx, width, height, time, level, stage, palette }: OrbFrame): void => {
    if (width < 4 || height < 4) return;

    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) / 2 - Math.min(width, height) * 0.04;
    const spin = SPIN[stage] ?? 0.4;
    const { tint, ink } = palette;

    // ── the halo ────────────────────────────────────────────────────────────
    // First, and underneath everything: the orb is a light source before it is
    // a diagram, and a diagram with no light behind it reads as a sticker.
    const halo = ctx.createRadialGradient(cx, cy, radius * 0.1, cx, cy, radius * 1.24);
    halo.addColorStop(0, rgba(tint, 0.3 + level * 0.16));
    halo.addColorStop(0.55, rgba(tint, 0.09));
    halo.addColorStop(1, rgba(tint, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.24, 0, Math.PI * 2);
    ctx.fill();

    // ── the bezel ───────────────────────────────────────────────────────────
    // Sixty ticks, every fifth long. A scale rather than a ring, which is what
    // makes the rotation legible: without the long ticks it turns and nothing
    // about it appears to move.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((time * 0.00006 * spin) % (Math.PI * 2));
    for (let i = 0; i < 60; i += 1) {
      const major = i % 5 === 0;
      const angle = (i / 60) * Math.PI * 2;
      const length = major ? radius * 0.1 : radius * 0.05;
      ctx.strokeStyle = rgba(ink, major ? 0.5 : 0.22);
      ctx.lineWidth = major ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      ctx.lineTo(Math.cos(angle) * (radius - length), Math.sin(angle) * (radius - length));
      ctx.stroke();
    }
    ctx.restore();

    // ── the arcs ────────────────────────────────────────────────────────────
    // Counter-rotating, so the orb has no single direction and never looks like
    // a loading spinner — which is the one thing it must not be mistaken for,
    // because a spinner means "wait" and this means "listening".
    const arc = (r: number, from: number, span: number, speed: number, weight: number, alpha: number): void => {
      const offset = (time * speed) % (Math.PI * 2);
      ctx.strokeStyle = rgba(tint, alpha);
      ctx.lineWidth = weight;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy, r, from + offset, from + offset + span);
      ctx.stroke();

      // The leading cap. A moving arc with no head is a smear; with one it is
      // something travelling, and the eye follows it round.
      const head = from + offset + span;
      ctx.fillStyle = rgba(tint, Math.min(1, alpha + 0.45));
      ctx.beginPath();
      ctx.arc(cx + Math.cos(head) * r, cy + Math.sin(head) * r, weight * 0.85, 0, Math.PI * 2);
      ctx.fill();
    };
    arc(radius * 0.82, 0, 1.5, 0.00042 * spin, 2.2, 0.55);
    arc(radius * 0.68, Math.PI, 1, -0.00068 * spin, 1.7, 0.4);

    // ── the sweep ───────────────────────────────────────────────────────────
    // Guarded: `createConicGradient` is not everywhere, and a missing sweep is a
    // quieter orb rather than a blank window.
    if (typeof ctx.createConicGradient === 'function') {
      const wedge = ctx.createConicGradient((time * 0.0005 * spin) % (Math.PI * 2), cx, cy);
      wedge.addColorStop(0, rgba(tint, 0.2 * level));
      wedge.addColorStop(0.12, rgba(tint, 0));
      wedge.addColorStop(1, rgba(tint, 0));
      ctx.fillStyle = wedge;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.9, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── the iris ────────────────────────────────────────────────────────────
    // Six facets, sized by the level. This is the part that answers "is it
    // hearing me" from across the room, so it is the part that moves most.
    const iris = radius * (0.3 + level * 0.16);
    ctx.strokeStyle = rgba(tint, 0.7);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i <= 6; i += 1) {
      const angle = (i / 6) * Math.PI * 2 + time * 0.00012 * spin;
      const x = cx + Math.cos(angle) * iris;
      const y = cy + Math.sin(angle) * iris;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();

    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, iris * 0.9);
    core.addColorStop(0, rgba(tint, 0.95));
    core.addColorStop(0.4, rgba(tint, 0.45));
    core.addColorStop(1, rgba(tint, 0));
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, iris * 0.9, 0, Math.PI * 2);
    ctx.fill();

    // ── the reticle ─────────────────────────────────────────────────────────
    ctx.strokeStyle = rgba(tint, 0.5);
    ctx.lineWidth = 1.2;
    for (let quarter = 0; quarter < 4; quarter += 1) {
      const angle = (quarter / 4) * Math.PI * 2 + Math.PI / 4;
      const x = cx + Math.cos(angle) * radius * 0.93;
      const y = cy + Math.sin(angle) * radius * 0.93;
      ctx.beginPath();
      ctx.moveTo(x - 3, y);
      ctx.lineTo(x + 3, y);
      ctx.moveTo(x, y - 3);
      ctx.lineTo(x, y + 3);
      ctx.stroke();
    }
  },
};
