/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { decide } from '@/common/permissions/decide';
import { DEFAULT_RULES } from '@/common/permissions/defaults';

describe('the default rules', () => {
  it('never prompts for the things a conversation is made of', () => {
    // An assistant that asks permission to look at a screen the user just
    // pointed at is one nobody keeps switched on. Prompt fatigue is not a
    // lesser failure than permissiveness; it produces permissiveness.
    for (const tool of [
      'app_look_at_screen',
      'app_search',
      'app_open_url',
      'app_theme',
      'app_skill_do',
      'app_find_video',
      'app_remember',
      'app_learn',
      'app_rule',
    ]) {
      expect(decide(DEFAULT_RULES, { tool })).toBe('allow');
    }
  });

  it('lets the agent read anywhere', () => {
    expect(decide(DEFAULT_RULES, { tool: 'Read', path: 'D:/work/notes.txt' })).toBe('allow');
    expect(decide(DEFAULT_RULES, { tool: 'Glob', path: 'D:/work/**' })).toBe('allow');
    expect(decide(DEFAULT_RULES, { tool: 'Grep', path: 'D:/work' })).toBe('allow');
  });

  it('refuses to write where the operating system lives', () => {
    expect(decide(DEFAULT_RULES, { tool: 'Write', path: 'C:/Windows/system32/x.dll' })).toBe('deny');
    expect(decide(DEFAULT_RULES, { tool: 'Edit', path: 'C:/Program Files/thing/app.exe' })).toBe('deny');
  });

  it('asks before anything that cannot be taken back', () => {
    expect(decide(DEFAULT_RULES, { tool: 'Bash', command: 'rm -rf D:/work' })).toBe('ask');
    expect(decide(DEFAULT_RULES, { tool: 'Bash', command: 'winget install something' })).toBe('ask');
    expect(decide(DEFAULT_RULES, { tool: 'Bash', command: 'shutdown /s' })).toBe('ask');
  });

  it('lets a harmless command through, so the assistant is still usable', () => {
    expect(decide(DEFAULT_RULES, { tool: 'Bash', command: 'git status --short' })).toBe('allow');
    expect(decide(DEFAULT_RULES, { tool: 'Bash', command: 'ls D:/work' })).toBe('allow');
  });

  it('does not let a chain buy an allow from its harmless half', () => {
    expect(decide(DEFAULT_RULES, { tool: 'Bash', command: 'git status && rm -rf D:/work' })).toBe('ask');
  });

  it('asks every time before sending', () => {
    // The cost of a wrong send is not paid by the person who clicked allow, so
    // this category never gets an "always".
    expect(decide(DEFAULT_RULES, { tool: 'app_send_message' })).toBe('ask');
  });

  it('asks for a tool nobody wrote a rule for', () => {
    expect(decide(DEFAULT_RULES, { tool: 'something_new' })).toBe('ask');
  });
});

describe('the ten spoken tasks, as a regression', () => {
  // If any of these starts prompting, the rules are wrong and the rules change
  // — not the task list. See docs/specs/2026-08-09-spoken-turn-tasks.md.
  it('lets every one of them run without a prompt', () => {
    const calls = [
      { tool: 'app_skill_do' }, // play my favourite song
      { tool: 'app_search' }, // open YouTube and find it
      { tool: 'app_look_at_screen' }, // what does this error say
      { tool: 'app_theme' }, // make the accent warmer
      { tool: 'app_remember' }, // my desktop is D:\Work
      { tool: 'app_skill_teach' }, // when I ask for a video…
      { tool: 'app_ask_jester' }, // book me a flight — refused by the agent, not by us
      { tool: 'app_open_url' }, // open my email
    ];

    for (const call of calls) {
      expect(decide(DEFAULT_RULES, call)).toBe('allow');
    }
  });
});
