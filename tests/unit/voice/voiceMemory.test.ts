/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  buildAgentBriefing,
  buildMemoryInstructions,
  DEFAULT_AGENT_DOC,
  DEFAULT_USER_DOC,
  EMPTY_VOICE_MEMORY,
  forgetFact,
  forgetSkill,
  learnLesson,
  learnSkill,
  listSkills,
  MEMORY_SECTIONS,
  readAddress,
  rememberAddress,
  rememberFact,
  rememberMeaning,
  rememberSession,
  sanitizeVoiceMemory,
  type VoiceMemory,
} from '@/common/voice/memory';
import { readSection } from '@/common/voice/memoryDoc';

const NOW = new Date('2026-08-06T12:00:00.000Z');

const introduced = (patch: Partial<VoiceMemory> = {}): VoiceMemory => ({
  ...EMPTY_VOICE_MEMORY,
  introduced: true,
  ...patch,
});

const facts = (memory: VoiceMemory): string[] => readSection(memory.user, MEMORY_SECTIONS.facts);

describe('sanitizeVoiceMemory', () => {
  it('reads back what was written', () => {
    const memory = rememberFact(rememberAddress(introduced(), 'Serhan'), 'Builds a desktop app called The Fool.');

    const restored = sanitizeVoiceMemory(JSON.parse(JSON.stringify(memory)));

    expect(readAddress(restored)).toBe('Serhan');
    expect(facts(restored)).toEqual(['Builds a desktop app called The Fool.']);
    expect(restored.introduced).toBe(true);
  });

  it('survives a record that is not one, rather than taking the app down', () => {
    expect(sanitizeVoiceMemory(null)).toEqual(EMPTY_VOICE_MEMORY);
    expect(sanitizeVoiceMemory('corrupt')).toEqual(EMPTY_VOICE_MEMORY);
    expect(sanitizeVoiceMemory({ user: 42, agent: [] })).toEqual(EMPTY_VOICE_MEMORY);
  });

  it('gives a cleared document its headings back rather than leaving nothing to write under', () => {
    expect(sanitizeVoiceMemory({ user: '   ', introduced: true }).user).toBe(DEFAULT_USER_DOC);
    expect(sanitizeVoiceMemory({ agent: '', introduced: true }).agent).toBe(DEFAULT_AGENT_DOC);
  });

  it('treats anything but true as not yet introduced, so a bad write asks again', () => {
    expect(sanitizeVoiceMemory({ introduced: 'yes' }).introduced).toBe(false);
  });

  /**
   * The shape this replaced. A memory written by the previous version is still
   * the user's memory, and losing it on an update is the exact failure the
   * feature exists to prevent.
   */
  it('rewrites a memory stored by the version before this one', () => {
    const restored = sanitizeVoiceMemory({
      addressAs: 'Serhan',
      facts: [{ id: 'f1', text: 'Uses Windows 11.', at: NOW.toISOString() }],
      sessions: [{ id: 's1', at: '2026-08-05T09:00:00.000Z', summary: 'Stuck on the installer.' }],
      introduced: true,
    });

    expect(readAddress(restored)).toBe('Serhan');
    expect(facts(restored)).toEqual(['Uses Windows 11.']);
    expect(readSection(restored.user, MEMORY_SECTIONS.sessions)).toEqual(['2026-08-05 — Stuck on the installer.']);
  });
});

describe('rememberFact', () => {
  it('does not keep the same thing twice, however it was punctuated', () => {
    let memory = rememberFact(introduced(), 'Uses Windows 11.');
    memory = rememberFact(memory, 'uses windows 11');

    expect(facts(memory)).toEqual(['uses windows 11']);
  });

  it('keeps the newest when there are more than it will hold', () => {
    let memory = introduced();
    for (let index = 0; index < 65; index += 1) memory = rememberFact(memory, `fact ${index}`);

    const kept = facts(memory);
    expect(kept).toHaveLength(60);
    expect(kept.at(-1)).toBe('fact 64');
    expect(kept[0]).toBe('fact 5');
  });

  it('ignores an empty one rather than storing a blank line', () => {
    expect(facts(rememberFact(introduced(), '   '))).toHaveLength(0);
  });
});

describe('rememberMeaning', () => {
  it('keeps what one of their own words stands for, apart from the facts', () => {
    const memory = rememberMeaning(introduced(), 'my desktop', 'C:\\Users\\example\\Desktop');

    expect(readSection(memory.user, MEMORY_SECTIONS.meanings)).toEqual(['"my desktop" — C:\\Users\\example\\Desktop']);
    expect(facts(memory)).toHaveLength(0);
  });

  it('needs both halves; a word with no meaning is not worth a line', () => {
    expect(rememberMeaning(introduced(), 'desktop', '  ')).toEqual(introduced());
  });
});

describe('forgetFact', () => {
  it('drops what was named, and leaves the rest', () => {
    let memory = rememberFact(introduced(), 'Allergic to walnuts.');
    memory = rememberFact(memory, 'Uses Windows 11.');

    expect(facts(forgetFact(memory, 'walnuts'))).toEqual(['Uses Windows 11.']);
  });

  it('matches on the words rather than on the exact sentence', () => {
    const memory = rememberFact(introduced(), 'Prefers the microphone on the desk, not the headset.');

    expect(facts(forgetFact(memory, 'the headset microphone'))).toHaveLength(0);
  });
});

describe('rememberSession', () => {
  it('dates the line rather than describing it, so it does not go stale on the shelf', () => {
    const memory = rememberSession(introduced(), 'Stuck on the installer.', NOW);

    expect(readSection(memory.user, MEMORY_SECTIONS.sessions)).toEqual(['2026-08-06 — Stuck on the installer.']);
  });

  it('keeps only the most recent handful', () => {
    let memory = introduced();
    for (let index = 0; index < 15; index += 1) memory = rememberSession(memory, `talk ${index}`, NOW);

    const kept = readSection(memory.user, MEMORY_SECTIONS.sessions);
    expect(kept).toHaveLength(12);
    expect(kept[0]).toBe('2026-08-06 — talk 3');
  });
});

describe('what the assistant learns about its own work', () => {
  it('writes a lesson into agent.md, not into the file about the user', () => {
    const memory = learnLesson(introduced(), 'When they say the desktop they mean the folder.');

    expect(readSection(memory.agent, MEMORY_SECTIONS.lessons)).toEqual([
      'When they say the desktop they mean the folder.',
    ]);
    expect(memory.user).toBe(DEFAULT_USER_DOC);
  });

  it('keeps a taught skill under the name they gave it', () => {
    const memory = learnSkill(introduced(), {
      name: 'Find a video',
      when: 'they ask me to play a song',
      steps: 'search YouTube for it and open the first result',
    });

    expect(listSkills(memory)).toEqual(['Find a video']);
    expect(memory.agent).toContain('When: they ask me to play a song');
    expect(memory.agent).toContain('Do: search YouTube for it and open the first result');
  });

  it('replaces a skill taught a second time rather than keeping both versions', () => {
    let memory = learnSkill(introduced(), { name: 'Find a video', when: 'a song', steps: 'search YouTube' });
    memory = learnSkill(memory, { name: 'Find a video', when: 'a song', steps: 'search YouTube and play the first' });

    expect(listSkills(memory)).toEqual(['Find a video']);
    expect(memory.agent).toContain('search YouTube and play the first');
    expect(memory.agent).not.toContain('Do: search YouTube\n');
  });

  it('drops a skill by whatever the user calls it', () => {
    const memory = learnSkill(introduced(), { name: 'Find a video', when: '', steps: 'search YouTube' });

    expect(listSkills(forgetSkill(memory, 'find a video'))).toEqual([]);
  });

  it('will not keep a skill with no steps, which would be a heading and nothing else', () => {
    expect(listSkills(learnSkill(introduced(), { name: 'Find a video', when: 'a song', steps: '' }))).toEqual([]);
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
    expect(instructions).toContain('Never read them back');
  });

  /**
   * A phrase like "yesterday" written into a file is wrong by the following
   * morning, so the document keeps the date and the prompt states today's.
   */
  it('gives the model today rather than a stale description of when things happened', () => {
    const memory = rememberSession(introduced(), 'Stuck on the installer.', new Date('2026-08-05T09:00:00.000Z'));

    const instructions = buildMemoryInstructions(memory, NOW);

    expect(instructions).toContain('Today is 2026-08-06');
    expect(instructions).toContain('2026-08-05 — Stuck on the installer.');
  });

  it('leaves out a document with nothing but headings in it', () => {
    const instructions = buildMemoryInstructions(learnLesson(introduced(), 'Check before promising.'), NOW);

    expect(instructions).toContain('agent.md');
    expect(instructions).not.toContain('user.md');
  });
});

describe('buildAgentBriefing', () => {
  it('sends the memory with the job, because the agent has never met them', () => {
    const memory = rememberMeaning(introduced(), 'my desktop', 'C:\\Users\\example\\Desktop');

    const briefing = buildAgentBriefing(memory, 'put the report on my desktop');

    expect(briefing).toContain('C:\\Users\\example\\Desktop');
    expect(briefing.trimEnd().endsWith('put the report on my desktop')).toBe(true);
  });

  it('hands over the request on its own when there is nothing worth saying', () => {
    expect(buildAgentBriefing(introduced(), 'open the browser')).toBe('open the browser');
  });
});
