/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  buildSkillBrief,
  buildSkillDraft,
  isDraftUsable,
  MAX_SKILL_NAME,
  skillSlug,
  type SkillDraft,
} from '@/common/voice/skillDraft';

/**
 * Teaching by explaining, and teaching by showing.
 *
 * The app could already be told a way of doing things, and what that produced
 * was a note the spoken assistant follows. This produces a real skill — a folder
 * with a SKILL.md in the library, available to every agent and to conversations
 * that were nowhere near the one where it was learned.
 */

const draft: SkillDraft = {
  name: 'Send an invoice',
  what: 'When the user asks to send an invoice to a client.',
  steps: 'Open the billing app, pick the client, export as PDF, attach it to a mail.',
};

describe('skillSlug', () => {
  it('survives being a folder name after arriving through a microphone', () => {
    expect(skillSlug('Fatura Gönder!')).toBe('fatura-gönder');
    expect(skillSlug('  Send   an Invoice  ')).toBe('send-an-invoice');
    expect(skillSlug('видео → таб')).toBe('видео-таб');
  });

  it('never answers with nothing, because nothing is not a folder', () => {
    expect(skillSlug('   ')).toBe('taught-skill');
    expect(skillSlug('!!!')).toBe('taught-skill');
  });

  it('stays short enough to be a path on every filesystem', () => {
    expect(skillSlug('a very long name '.repeat(10)).length).toBeLessThanOrEqual(MAX_SKILL_NAME);
  });
});

describe('isDraftUsable', () => {
  it('needs a name and the steps; what it is for can be filled in later', () => {
    expect(isDraftUsable(draft)).toBe(true);
    expect(isDraftUsable({ ...draft, what: '' })).toBe(true);
    expect(isDraftUsable({ ...draft, steps: '  ' })).toBe(false);
    expect(isDraftUsable({ ...draft, name: '' })).toBe(false);
  });
});

describe('buildSkillDraft', () => {
  const body = buildSkillDraft(draft);

  it('writes the front matter the loader reads', () => {
    expect(body.startsWith('---\n')).toBe(true);
    expect(body).toContain('name: send-an-invoice');
    expect(body).toContain('description:');
  });

  /**
   * The description is the only thing that decides whether a skill is ever
   * reached for. A name tells a model nothing about when to use it.
   */
  it('builds the description from what it is for, not from its title', () => {
    expect(body).toContain('When the user asks to send an invoice to a client.');
  });

  it('keeps the user’s own method rather than a tidied version of it', () => {
    expect(body).toContain('Open the billing app, pick the client, export as PDF');
    expect(body).toContain('follow it rather than solving the');
  });

  it('keeps the description on one line, because the front matter is line-based', () => {
    const front = body.slice(4, body.indexOf('\n---', 4));
    expect(front.split('\n').filter((line) => line.startsWith('description:'))).toHaveLength(1);
  });

  it('points at the screenshots when there was a demonstration, and not when there was not', () => {
    const shown = buildSkillDraft(draft, {
      folder: 'C:/x/send-an-invoice-1',
      frames: [
        { file: 'frame-001.png', at: 0 },
        { file: 'frame-002.png', at: 2.5 },
      ],
      seconds: 5,
    });

    expect(shown).toContain('2 screenshots');
    expect(shown).toContain('frames/');
    expect(body).not.toContain('frames/');
  });
});

describe('buildSkillBrief', () => {
  const folder = 'C:\\Users\\x\\fool\\skill-recordings\\send-an-invoice-1';

  it('tells the agent the draft is the requirement, not a starting suggestion', () => {
    const brief = buildSkillBrief(draft, folder);

    expect(brief).toContain('improve the wording, do not replace the');
    expect(brief).toContain('/skill/SKILL.md');
  });

  it('hands over a path the shell will accept on Windows', () => {
    const brief = buildSkillBrief(draft, folder);

    expect(brief).not.toContain('\\Users');
    expect(brief).toContain('/fool/skill-recordings/send-an-invoice-1/skill');
  });

  it('asks it to actually install the skill, and not to claim it did', () => {
    const brief = buildSkillBrief(draft, folder);

    expect(brief).toContain('config skills import');
    expect(brief).toContain('Do not report');
  });

  /**
   * A recording of someone's screen catches whatever was on it. The frames are
   * kept where the user can open and delete them, and the agent reading them is
   * told plainly not to write down what it should not have seen.
   */
  it('tells it to look at the frames, and to leave out what was not meant to be kept', () => {
    const brief = buildSkillBrief(draft, folder, {
      folder,
      frames: [{ file: 'frame-001.png', at: 0 }],
      seconds: 3,
    });

    expect(brief).toContain('1 screenshots');
    expect(brief).toContain('Name the actual applications, windows, menus and buttons');
    expect(brief).toContain('do not write it down');
  });

  it('says nothing about frames when nothing was recorded', () => {
    expect(buildSkillBrief(draft, folder)).not.toContain('screenshots');
  });
});
