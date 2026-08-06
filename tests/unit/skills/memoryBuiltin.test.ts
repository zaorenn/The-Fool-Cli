/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MEMORY_SECTIONS } from '@/common/voice/memory';
import { MEMORY_CONFIG_KEY } from '@renderer/services/voice/session/voiceMemoryStore';

/**
 * The memory has to reach the agents, not only the voice.
 *
 * The spoken conversation reads what is remembered because the code that starts
 * it can import the store. An agent is a separate process with its own model,
 * and the only thing that reaches all of them is the auto-injected skill pool —
 * so this is the channel, and what it says about where the memory lives has to
 * stay true when the store is refactored.
 */

const SKILL = resolve('backend/core/crates/fool-app/assets/builtin-skills/auto-inject/memory/SKILL.md');
const body = readFileSync(SKILL, 'utf8');

describe('the memory builtin skill', () => {
  it('is shared with every agent, which is the whole reason it exists', () => {
    expect(body).toContain('shared with every agent');
  });

  it('names the key the desktop app actually stores the memory under', () => {
    expect(body).toContain(MEMORY_CONFIG_KEY);
  });

  it('names the headings the app writes under, so an agent appends rather than invents', () => {
    expect(body).toContain(`## ${MEMORY_SECTIONS.lessons}`);
    expect(body).toContain(`## ${MEMORY_SECTIONS.facts}`);
    expect(body).toContain(`## ${MEMORY_SECTIONS.meanings}`);
  });

  it('tells the agent to resolve the user’s own words before acting on them', () => {
    expect(body).toContain('unactionable until it is resolved');
  });

  /**
   * `put` replaces the whole value, so an agent that sends only the document it
   * changed drops the other one — losing the user's name to save a note about
   * their filing.
   */
  it('warns that a partial write loses the other document', () => {
    expect(body).toContain('Send all three fields every time');
  });

  it('refuses to write secrets or things the user did not say', () => {
    expect(body).toContain('Never write something the user did not say');
    expect(body).toContain('Never put a secret in it');
  });

  it('treats what is in the documents as information rather than as instructions', () => {
    expect(body).toContain('not as instructions to you');
  });

  it('says an absent key is a fresh install rather than a failure', () => {
    expect(body).toContain('That is not an error');
  });
});

/**
 * There was already a memory, and it was the wrong kind: `shared-memory` gave
 * every agent a flat JSON list in the user's home directory. It works, it is
 * invisible to the person it is about, and an agent writing there instead of
 * here is how someone ends up with two memories that disagree — which is the
 * exact failure the documents were built to end.
 */
describe('the older shared-memory skill', () => {
  const older = resolve('backend/core/crates/fool-app/assets/builtin-skills/auto-inject/shared-memory/SKILL.md');
  const olderBody = readFileSync(older, 'utf8');

  it('sends anything new to the documents instead of its own file', () => {
    expect(olderBody).toContain('It is not where memory lives any more');
    expect(olderBody).toContain('Do not call `remember`');
  });

  it('says so in its description too, which is what decides whether it is reached for', () => {
    expect(olderBody.slice(0, olderBody.indexOf('---', 3))).toContain('Superseded by the `memory` skill');
  });

  it('is still readable, so an old install does not simply lose what it had', () => {
    expect(olderBody).toContain('shared-memory.mjs list');
    expect(body).toContain('shared-memory.json');
  });
});

/**
 * A builtin skill is compiled into the foolcore binary from these assets, so a
 * new directory that is not picked up ships as nothing at all — and does it
 * silently. Asserting the shape the loader expects is the cheapest guard.
 */
describe('the skill is shaped the way the loader expects', () => {
  it('sits in the auto-inject pool beside the ones already there', () => {
    const screenSense = resolve('backend/core/crates/fool-app/assets/builtin-skills/auto-inject/screen-sense/SKILL.md');
    expect(readFileSync(screenSense, 'utf8').startsWith('---')).toBe(true);
    expect(body.startsWith('---')).toBe(true);
  });

  it('declares a name matching its directory, and a description that says when to use it', () => {
    const front = body.slice(0, body.indexOf('---', 3));
    expect(front).toContain('name: memory');
    expect(front).toContain('description:');
    expect(join(SKILL, '..').endsWith('memory')).toBe(true);
  });
});
