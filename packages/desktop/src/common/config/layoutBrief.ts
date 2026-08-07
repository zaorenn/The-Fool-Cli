/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The app's own specification, written out for somebody else's AI.
 *
 * Turning nine controls is not how most people describe what they want. "Make it
 * look like an old oscilloscope" is a sentence, and the person who can say it
 * often cannot build it — not because it is hard, but because knowing which of
 * nine dials produces *that* is exactly the knowledge they do not have and
 * should not need. They already have an AI they talk to. So the app hands them
 * its specification, they paste it wherever they like along with their sentence,
 * and they bring the answer back.
 *
 * Generated from the same catalogues the editor draws and the sanitiser checks,
 * never written out by hand. A hand-written brief describes the app as it was on
 * the day somebody wrote it, and the day an axis is added it quietly starts
 * telling external models to produce presets this app rejects — with no error
 * anywhere, because a brief is only text. Generating it means an axis added
 * tomorrow is in the instructions tomorrow.
 *
 * Deliberately not a promise about which model. It is a description of a data
 * format and the taste to apply to it, so it works with whatever the person
 * already pays for, and the app never has to hold a key or make a request.
 */

import { MAX_MOTIONS, MOTION_EASINGS, MOTION_MOVES, MOTION_TARGETS, MOTION_TARGET_SURFACE } from './layoutMotions';
import { LAYOUT_TOKEN_KEYS, TOKEN_SPECS } from './layoutTokens';
import { LAYOUT_OPTION_VALUES, SURFACE_IDS, surfaceOptionKeys, type SurfaceId } from './surfaceLayouts';

/** What each window is, in a sentence a stranger's model can use. */
const SURFACE_NOTE: Record<SurfaceId, string> = {
  voice: 'the voice assistant page — a live conversation with a level meter',
  chat: 'the chat window — a written conversation and its messages',
  hub: "Fool's Hub — the page of workspace cards",
  frame: 'the app frame itself — the sidebar and the title bar, around every other window',
};

const axisLines = (surface: SurfaceId): string =>
  surfaceOptionKeys(surface)
    .map((key) => `    - ${key}: ${(LAYOUT_OPTION_VALUES[key] as readonly string[]).join(' | ')}`)
    .join('\n');

const tokenLines = (): string =>
  LAYOUT_TOKEN_KEYS.map((key) => {
    const spec = TOKEN_SPECS[key];
    const unit = spec.unit.length > 0 ? ` ${spec.unit}` : '';
    return `  - ${key}: ${spec.min} to ${spec.max}${unit}, step ${spec.step}, default ${spec.fallback}`;
  }).join('\n');

const motionTargetLines = (): string =>
  MOTION_TARGETS.map((target) => `  - ${target} (belongs to the ${MOTION_TARGET_SURFACE[target]} window)`).join('\n');

/**
 * A preset this app accepts, as an example.
 *
 * One example rather than four, and a plain one: a model given four elaborate
 * samples copies their taste, and the taste is supposed to come from the person
 * describing what they want.
 */
const EXAMPLE = {
  name: 'Oscilloscope',
  surface: 'chat',
  options: { bubbles: 'flat', panel: 'drawer', motion: 'full', density: 'compact' },
  tokens: { radius: 0, spacing: 0.9, textScale: 0.95, motionMs: 120, accent: 1, contrast: 0.75 },
  motions: [{ target: 'message', move: 'rise', durationMs: 160, distancePx: 8, easing: 'sharp' }],
};

export const layoutBrief = (): string =>
  [
    'You are designing an interface preset for an app called The Fool.',
    '',
    'The person you are talking to will describe a look they want. Turn it into one',
    'preset in the exact JSON format below. They cannot edit JSON, so it has to be',
    'right the first time.',
    '',
    '## What a preset is',
    '',
    'The app has four windows whose shape can be chosen independently. A preset',
    'shapes exactly one of them. If the person describes a whole look, ask them',
    'which window, or produce the one their description is mostly about and say so',
    'in one line before the JSON.',
    '',
    ...SURFACE_IDS.map((surface) => `- "${surface}" — ${SURFACE_NOTE[surface]}\n${axisLines(surface)}`),
    '',
    'Use only the values listed. Anything else is dropped when the file is read,',
    'and the window silently keeps what it had.',
    '',
    '## The dials',
    '',
    'Numbers, applied to the whole app. Stay inside the range and on the step:',
    '',
    tokenLines(),
    '',
    'radius 0 is a square corner and is a real choice. motionMs 0 means instant.',
    '',
    '## Movements',
    '',
    `Optional, up to ${MAX_MOTIONS}. Each one animates a thing as it appears.`,
    '',
    'What can move:',
    motionTargetLines(),
    '',
    `How it can arrive: ${MOTION_MOVES.join(' | ')}`,
    `How it is paced: ${MOTION_EASINGS.join(' | ')}`,
    'durationMs: 0 to 2000. distancePx: 0 to 64, and only matters for the moves that travel.',
    '',
    "A movement only plays on the window it belongs to, so put it in that window's preset.",
    '',
    '## Taste',
    '',
    'Take the direction from what they said, not from what interfaces usually look',
    'like. A few specific decisions that match their description beat a preset that',
    'moves every dial a little. Some rules that hold regardless:',
    '',
    '- One idea, applied consistently. Corners, spacing and motion should agree with each other.',
    '- Movements should be short. Above roughly 300ms an interface feels slow rather than smooth.',
    '- Do not animate everything. One or two movements is a design; five is noise.',
    '- If they describe something still or serious, motion "calm" or "none" is the right answer, not a slow animation.',
    '',
    '## Answer with',
    '',
    'Only the JSON, in one fenced block. No explanation around it unless you had to',
    'pick a window for them, in which case one line first.',
    '',
    '```json',
    JSON.stringify(EXAMPLE, null, 2),
    '```',
    '',
    'The person will save that as a .json file and drop it onto the layout editor',
    'in Settings, or paste it there directly.',
  ].join('\n');
