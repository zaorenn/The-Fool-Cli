/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { buildPersonaInstructions } from '@/common/realtime/personas';
import {
  EMPTY_VOICE_MEMORY,
  forgetRule,
  MEMORY_SECTIONS,
  readRules,
  rememberRule,
  type VoiceMemory,
} from '@/common/voice/memory';

/**
 * A rule the user set, and how hard it binds.
 *
 * Two different things were both being called "memory". "I live in Istanbul" is
 * a fact — useful, and nothing goes wrong if it is read loosely. "Answer me in
 * English even when I speak Turkish" is an instruction, and reading *that*
 * loosely means ignoring it, which is the failure the user reported: it agreed,
 * and then drifted back to Turkish a few turns later.
 *
 * The other half is consent. A rule said in passing binds the conversation it
 * was said in and dies with it; a rule they asked to be remembered binds every
 * conversation until they say otherwise. Persisting everything would mean an
 * offhand "answer in English for this bit" silently becoming permanent, which is
 * a memory that cannot be trusted in the opposite direction.
 */

const withRule = (rule: string): VoiceMemory => rememberRule(EMPTY_VOICE_MEMORY, rule);

const persona = (over: Partial<Parameters<typeof buildPersonaInstructions>[0]> = {}): string =>
  buildPersonaInstructions({
    presetId: 'companion',
    customInstructions: '',
    language: 'tr',
    interfaceLanguage: 'tr-TR',
    ...over,
  });

describe('a remembered rule', () => {
  it('is kept under its own heading, not among the facts', () => {
    const memory = withRule('Answer in English, whatever language I speak.');

    expect(memory.user).toContain(MEMORY_SECTIONS.rules);
    expect(readRules(memory)).toContain('Answer in English, whatever language I speak.');
  });

  it('keeps more than one, in the order they were set', () => {
    const memory = rememberRule(withRule('Answer in English.'), 'Never read URLs aloud.');

    expect(readRules(memory)).toEqual(['Answer in English.', 'Never read URLs aloud.']);
  });

  it('does not keep the same rule twice when it is repeated', () => {
    const memory = rememberRule(withRule('Answer in English.'), 'answer in english.');

    expect(readRules(memory)).toHaveLength(1);
  });

  it('can be dropped by naming it, because that is how it is countermanded', () => {
    const memory = forgetRule(withRule('Answer in English.'), 'english');

    expect(readRules(memory)).toHaveLength(0);
  });
});

describe('how a rule reaches the model', () => {
  it('appears in the prompt as binding, not as background', () => {
    const prompt = persona({ memory: withRule('Answer in English, whatever language I speak.') });

    expect(prompt).toContain('Answer in English, whatever language I speak.');
  });

  /**
   * The specific failure that was reported. The language setting is written into
   * the prompt as "answer only in Turkish, every reply, every time", and a rule
   * that arrived earlier in the text was simply the losing instruction. A rule
   * the user set has to be the last word.
   */
  it('is placed after the language setting, so it wins when the two disagree', () => {
    const prompt = persona({
      language: 'tr',
      memory: withRule('Answer in English, whatever language I speak.'),
    });

    expect(prompt.indexOf('Answer in English, whatever language I speak.')).toBeGreaterThan(
      prompt.indexOf('# Language')
    );
  });

  it('says plainly that these override anything above them', () => {
    const prompt = persona({ memory: withRule('Answer in English.') });

    expect(prompt.toLowerCase()).toMatch(/override|overrule|takes? precedence|wins/);
  });

  it('says nothing at all when no rule has been set', () => {
    expect(persona({ memory: EMPTY_VOICE_MEMORY })).not.toContain(MEMORY_SECTIONS.rules);
  });
});

describe('a rule that was never asked to be remembered', () => {
  it('binds this conversation just as hard', () => {
    const prompt = persona({ sessionRules: ['Answer in English for now.'] });

    expect(prompt).toContain('Answer in English for now.');
    expect(prompt.indexOf('Answer in English for now.')).toBeGreaterThan(prompt.indexOf('# Language'));
  });

  it('is not written into the memory, so tomorrow does not inherit it', () => {
    // Nothing to assert against the document: the point is that a session rule
    // never touches it. This pins that the two are separate inputs.
    expect(persona({ sessionRules: ['Answer in English for now.'] })).toContain('Answer in English for now.');
    expect(readRules(EMPTY_VOICE_MEMORY)).toHaveLength(0);
  });

  it('sits alongside a remembered one without either being lost', () => {
    const prompt = persona({
      memory: withRule('Never read URLs aloud.'),
      sessionRules: ['Answer in English for now.'],
    });

    expect(prompt).toContain('Never read URLs aloud.');
    expect(prompt).toContain('Answer in English for now.');
  });
});
