/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  buildMemoryInstructions,
  describeAge,
  EMPTY_VOICE_MEMORY,
  forgetFact,
  MAX_MEMORY_FACTS,
  MAX_MEMORY_SESSIONS,
  rememberAddress,
  rememberFact,
  rememberSession,
  sanitizeVoiceMemory,
  type VoiceMemory,
} from '@/common/voice/memory';

const AT = '2026-08-06T12:00:00.000Z';
const NOW = Date.parse(AT);

const introduced = (patch: Partial<VoiceMemory> = {}): VoiceMemory => ({
  ...EMPTY_VOICE_MEMORY,
  introduced: true,
  ...patch,
});

describe('sanitizeVoiceMemory', () => {
  it('reads back what was written', () => {
    const memory = rememberFact(rememberAddress(introduced(), 'Serhan'), 'Builds a desktop app called The Fool.');

    const restored = sanitizeVoiceMemory(JSON.parse(JSON.stringify(memory)));

    expect(restored.addressAs).toBe('Serhan');
    expect(restored.facts.map((fact) => fact.text)).toEqual(['Builds a desktop app called The Fool.']);
    expect(restored.introduced).toBe(true);
  });

  it('survives a record that is not one, rather than taking the app down', () => {
    expect(sanitizeVoiceMemory(null)).toEqual(EMPTY_VOICE_MEMORY);
    expect(sanitizeVoiceMemory('corrupt')).toEqual(EMPTY_VOICE_MEMORY);
    expect(sanitizeVoiceMemory({ facts: 'not a list', sessions: 7 }).facts).toEqual([]);
  });

  it('drops entries with nothing in them', () => {
    const restored = sanitizeVoiceMemory({ facts: [{ text: '   ' }, { text: 'real' }], introduced: true });

    expect(restored.facts.map((fact) => fact.text)).toEqual(['real']);
  });

  it('treats anything but true as not yet introduced, so a bad write asks again', () => {
    expect(sanitizeVoiceMemory({ introduced: 'yes' }).introduced).toBe(false);
  });
});

describe('rememberFact', () => {
  it('does not keep the same thing twice, however it was punctuated', () => {
    let memory = rememberFact(introduced(), 'Uses Windows 11.');
    memory = rememberFact(memory, 'uses windows 11');

    expect(memory.facts).toHaveLength(1);
    expect(memory.facts[0].text).toBe('uses windows 11');
  });

  it('keeps the newest when there are more than it will hold', () => {
    let memory = introduced();
    for (let index = 0; index < MAX_MEMORY_FACTS + 5; index += 1) memory = rememberFact(memory, `fact ${index}`);

    expect(memory.facts).toHaveLength(MAX_MEMORY_FACTS);
    expect(memory.facts.at(-1)?.text).toBe(`fact ${MAX_MEMORY_FACTS + 4}`);
  });

  it('ignores an empty one rather than storing a blank line', () => {
    expect(rememberFact(introduced(), '   ').facts).toHaveLength(0);
  });
});

describe('forgetFact', () => {
  it('drops what was named, and leaves the rest', () => {
    let memory = rememberFact(introduced(), 'Allergic to walnuts.');
    memory = rememberFact(memory, 'Uses Windows 11.');

    const after = forgetFact(memory, 'walnuts');

    expect(after.facts.map((fact) => fact.text)).toEqual(['Uses Windows 11.']);
  });

  it('matches on the words rather than on the exact sentence', () => {
    const memory = rememberFact(introduced(), 'Prefers the microphone on the desk, not the headset.');

    expect(forgetFact(memory, 'the headset microphone').facts).toHaveLength(0);
  });
});

describe('rememberSession', () => {
  it('keeps only the most recent handful', () => {
    let memory = introduced();
    for (let index = 0; index < MAX_MEMORY_SESSIONS + 3; index += 1) memory = rememberSession(memory, `talk ${index}`);

    expect(memory.sessions).toHaveLength(MAX_MEMORY_SESSIONS);
    expect(memory.sessions[0].summary).toBe('talk 3');
  });
});

describe('describeAge', () => {
  it('says it the way a person would', () => {
    expect(describeAge(AT, NOW)).toBe('today');
    expect(describeAge(AT, NOW + 86_400_000)).toBe('yesterday');
    expect(describeAge(AT, NOW + 3 * 86_400_000)).toBe('3 days ago');
    expect(describeAge(AT, NOW + 9 * 86_400_000)).toBe('last week');
  });

  it('does not produce a timestamp for something unparseable', () => {
    expect(describeAge('not a date', NOW)).toBe('at some point');
  });
});

describe('buildMemoryInstructions', () => {
  it('asks who it is talking to the first time, and only then', () => {
    const first = buildMemoryInstructions(EMPTY_VOICE_MEMORY, NOW);

    expect(first).toContain('first time');
    expect(first).toContain('what they would like to be called');
    expect(first).toContain('app_remember');
  });

  it('stops asking once the introduction has happened', () => {
    expect(buildMemoryInstructions(introduced(), NOW)).not.toContain('first time');
  });

  it('states the name as a fact to use, not as a record to read out', () => {
    const instructions = buildMemoryInstructions(rememberAddress(introduced(), 'Serhan'), NOW);

    expect(instructions).toContain('Serhan');
    expect(instructions).toContain('Never read this list back');
  });

  it('dates a past conversation in words rather than in a timestamp', () => {
    const memory = introduced({
      sessions: [{ id: 's1', at: new Date(NOW - 86_400_000).toISOString(), summary: 'Stuck on the installer.' }],
    });

    const instructions = buildMemoryInstructions(memory, NOW);

    expect(instructions).toContain('yesterday: Stuck on the installer.');
    expect(instructions).not.toContain('T00:00');
  });
});
