/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Keeps the shared animation language identical across every pet state.
 *
 * The states are hand-drawn scenes — a laptop, a broom, a crate — so they are
 * not generated. What they must share is the *motion*: the same breath, the same
 * blink, the same secondary sway in the hat, or the character stops reading as
 * one creature when the state changes. That core lives here and is written into
 * each file between the two markers, so a change to the motion is a change in
 * one place.
 *
 *   node scripts/sync-pet-animation-core.mjs          # write
 *   node scripts/sync-pet-animation-core.mjs --check  # verify only (CI-friendly)
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const STATES_DIR = path.resolve(import.meta.dirname, '..', 'public', 'pet-states');
const OPEN = '/* ==PET-CORE== */';
const CLOSE = '/* ==/PET-CORE== */';

/**
 * Durations are deliberately not multiples of each other (3.7 / 6.1 / 4.3 / 11)
 * so the loop never lands on an obvious beat.
 */
export const PET_CORE = `
      /* Anchor transforms at each shape's own box so the numbers read as intent
         rather than as viewBox arithmetic. */
      .pet-body,
      .pet-head,
      .pet-hat,
      .pet-eye,
      .pet-pupil,
      .pet-lid,
      .pet-shadow,
      .pet-arm-l,
      .pet-arm-r {
        transform-box: fill-box;
      }

      /* Breath scales from the feet, never from the centre. */
      .pet-body {
        transform-origin: 50% 100%;
        animation: pet-breathe 3.7s cubic-bezier(0.45, 0, 0.55, 1) infinite;
      }

      /* A slow lean, offset from the breath so the two never sync up. */
      .pet-lean {
        animation: pet-sway 6.1s cubic-bezier(0.37, 0, 0.63, 1) infinite;
      }

      /* The head is carried, it does not drive: it follows a beat late. */
      .pet-head {
        transform-origin: 50% 100%;
        animation: pet-bob 3.7s cubic-bezier(0.45, 0, 0.55, 1) infinite;
        animation-delay: 0.22s;
      }

      /* The bells trail further behind again. */
      .pet-hat {
        transform-origin: 50% 100%;
        animation: pet-hat-swing 6.1s cubic-bezier(0.37, 0, 0.63, 1) infinite;
        animation-delay: 0.38s;
      }

      /* The lid is the blink. In its own group so the pupil underneath can go on
         tracking the cursor while the eye is shut. */
      .pet-lid {
        transform-origin: 50% 0%;
        animation: pet-blink 4.3s cubic-bezier(0.3, 0, 0.2, 1) infinite;
      }

      /* Involuntary flicks between rests, as eyes actually move. */
      .pet-saccade {
        transform-origin: 50% 50%;
        animation: pet-saccade 11s steps(1, end) infinite;
      }

      .pet-shine {
        animation: pet-shine 4.3s ease-in-out infinite;
      }

      /* Tied to the breath, so contact with the ground stays believable. */
      .pet-shadow {
        transform-origin: 50% 50%;
        animation: pet-shadow 3.7s cubic-bezier(0.45, 0, 0.55, 1) infinite;
      }

      .pet-arm-l {
        transform-origin: 100% 0%;
        animation: pet-arm-l 6.1s cubic-bezier(0.37, 0, 0.63, 1) infinite;
        animation-delay: 0.3s;
      }

      .pet-arm-r {
        transform-origin: 0% 0%;
        animation: pet-arm-r 6.1s cubic-bezier(0.37, 0, 0.63, 1) infinite;
        animation-delay: 0.46s;
      }

      /* The rise is quicker than the fall, like a real breath. */
      @keyframes pet-breathe {
        0% { transform: scale(1, 1) translateY(0); }
        38% { transform: scale(0.988, 1.014) translateY(-0.16px); }
        100% { transform: scale(1, 1) translateY(0); }
      }

      @keyframes pet-sway {
        0%, 100% { transform: rotate(0deg) translateX(0); }
        27% { transform: rotate(1.15deg) translateX(0.1px); }
        52% { transform: rotate(0.1deg) translateX(0); }
        78% { transform: rotate(-1.15deg) translateX(-0.1px); }
      }

      @keyframes pet-bob {
        0% { transform: translateY(0) rotate(0deg); }
        38% { transform: translateY(-0.22px) rotate(-0.5deg); }
        100% { transform: translateY(0) rotate(0deg); }
      }

      @keyframes pet-hat-swing {
        0%, 100% { transform: rotate(0deg); }
        27% { transform: rotate(3.4deg); }
        55% { transform: rotate(-0.6deg); }
        80% { transform: rotate(-3.4deg); }
      }

      /* Down fast, up slower, then a second flick: the shape of a real blink
         rather than an on/off frame. */
      @keyframes pet-blink {
        0%, 88% { transform: scaleY(0); }
        90.5% { transform: scaleY(1); }
        93% { transform: scaleY(0.08); }
        95.5% { transform: scaleY(1); }
        98% { transform: scaleY(0); }
      }

      @keyframes pet-saccade {
        0%, 34% { transform: translate(0, 0); }
        36%, 55% { transform: translate(0.42px, -0.12px); }
        57%, 72% { transform: translate(-0.36px, 0.08px); }
        74%, 100% { transform: translate(0, 0); }
      }

      @keyframes pet-shine {
        0%, 100% { transform: translate(0, 0); opacity: 0.9; }
        45% { transform: translate(0.12px, 0.06px); opacity: 0.72; }
      }

      @keyframes pet-shadow {
        0% { transform: scaleX(1); opacity: 0.34; }
        38% { transform: scaleX(0.955); opacity: 0.26; }
        100% { transform: scaleX(1); opacity: 0.34; }
      }

      @keyframes pet-arm-l {
        0%, 100% { transform: rotate(0deg); }
        27% { transform: rotate(-5deg); }
        78% { transform: rotate(4deg); }
      }

      @keyframes pet-arm-r {
        0%, 100% { transform: rotate(0deg); }
        27% { transform: rotate(5deg); }
        78% { transform: rotate(-4deg); }
      }

      @media (prefers-reduced-motion: reduce) {
        .pet-body,
        .pet-lean,
        .pet-head,
        .pet-hat,
        .pet-lid,
        .pet-saccade,
        .pet-shine,
        .pet-shadow,
        .pet-arm-l,
        .pet-arm-r {
          animation: none;
        }
      }
`;

const CORE_BLOCK = `${OPEN}${PET_CORE}      ${CLOSE}`;

/** Replaces the marked block, or reports the file as unmarked. */
const withCore = (svg) => {
  const start = svg.indexOf(OPEN);
  const end = svg.indexOf(CLOSE);
  if (start === -1 || end === -1) return null;
  return `${svg.slice(0, start)}${CORE_BLOCK}${svg.slice(end + CLOSE.length)}`;
};

const main = async () => {
  const checkOnly = process.argv.includes('--check');
  const files = (await readdir(STATES_DIR)).filter((name) => name.endsWith('.svg')).sort();

  const unmarked = [];
  const stale = [];
  let written = 0;

  for (const name of files) {
    const file = path.join(STATES_DIR, name);
    const svg = await readFile(file, 'utf8');
    const next = withCore(svg);

    if (next === null) {
      unmarked.push(name);
      continue;
    }
    if (next === svg) continue;

    stale.push(name);
    if (!checkOnly) {
      await writeFile(file, next, 'utf8');
      written += 1;
    }
  }

  if (unmarked.length > 0) {
    console.log(`States without the core markers (not yet rebuilt): ${unmarked.join(', ')}`);
  }

  if (checkOnly) {
    if (stale.length > 0) {
      console.error(`Animation core out of sync in: ${stale.join(', ')}`);
      process.exit(1);
    }
    console.log(`Animation core in sync across ${files.length - unmarked.length} states.`);
    return;
  }

  console.log(`Animation core written to ${written} state(s); ${files.length - unmarked.length} carry it.`);
};

await main();
