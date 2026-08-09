/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_SNAPSHOTS,
  afterRestoring,
  previousVersion,
  versionsNewestFirst,
  withSnapshot,
} from '@/common/voice/memorySnapshots';
import {
  MAX_PROPOSALS,
  acceptedLines,
  alreadyKnown,
  alreadyRefused,
  worthOffering,
} from '@/common/voice/memoryProposal';

const memory = (user: string, agent = '') => ({ user, agent, introduced: true });

describe('memory snapshots', () => {
  it('keeps what the memory said before a change', () => {
    const kept = withSnapshot([], memory('# User\n\n- Called: Ada\n'), 'remembered a name', 1);
    expect(previousVersion(kept)?.memory.user).toContain('Ada');
    expect(previousVersion(kept)?.reason).toBe('remembered a name');
  });

  it('has nothing to go back to before anything happened', () => {
    expect(previousVersion([])).toBeNull();
  });

  it('drops the oldest rather than growing without limit', () => {
    let kept = withSnapshot([], memory('first'), 'r', 1);
    for (let index = 0; index < MAX_SNAPSHOTS + 5; index += 1) {
      kept = withSnapshot(kept, memory(`v${index}`), 'r', index + 2);
    }

    expect(kept).toHaveLength(MAX_SNAPSHOTS);
    // The version somebody wants back is nearly always a recent one.
    expect(kept[0].memory.user).not.toBe('first');
  });

  it('shows the newest first, for somebody looking for a version', () => {
    const kept = withSnapshot(withSnapshot([], memory('old'), 'r', 1), memory('new'), 'r', 2);
    expect(versionsNewestFirst(kept)[0].memory.user).toBe('new');
  });

  it('does not let undo become a loop', () => {
    // Restoring, then restoring again, must not put the change back — that
    // reads as the application arguing with the user about their own memory.
    const kept = withSnapshot(withSnapshot([], memory('a'), 'r', 1), memory('b'), 'r', 2);
    const after = afterRestoring(kept);

    expect(previousVersion(after)?.memory.user).toBe('a');
    expect(afterRestoring(after)).toHaveLength(0);
  });
});

describe('what is worth offering', () => {
  const existing = { user: '# User\n\n- Calls their desktop D:/Work\n', agent: '' };

  it('offers something new, with its evidence', () => {
    const offered = worthOffering(
      [
        {
          target: 'user',
          line: 'Works on a desktop application in the evenings.',
          evidence: '"I build this after work"',
        },
      ],
      existing
    );

    expect(offered).toHaveLength(1);
    expect(offered[0].evidence).toContain('after work');
  });

  it('does not repeat what the memory already says', () => {
    // Folded before comparing: the same sentence in different case is the same
    // sentence, and offering both is how a memory becomes near-duplicates.
    const offered = worthOffering(
      [{ target: 'user', line: 'calls their desktop d:/work', evidence: '"my desktop"' }],
      existing
    );

    expect(offered).toEqual([]);
  });

  it('drops a proposal that cannot say why it exists', () => {
    // A proposal with no evidence gives the user no way to judge it, and
    // showing it teaches them to approve blindly.
    const offered = worthOffering([{ target: 'user', line: 'Likes jazz.', evidence: '   ' }], existing);
    expect(offered).toEqual([]);
  });

  it('does not offer the same thing twice in one sitting', () => {
    const offered = worthOffering(
      [
        { target: 'user', line: 'Likes jazz.', evidence: '"jazz"' },
        { target: 'user', line: 'likes jazz', evidence: '"jazz again"' },
      ],
      existing
    );

    expect(offered).toHaveLength(1);
  });

  it('offers no more than a handful at once', () => {
    const many = Array.from({ length: MAX_PROPOSALS + 4 }, (_, index) => ({
      target: 'user' as const,
      line: `Fact number ${index}.`,
      evidence: `"evidence ${index}"`,
    }));

    expect(worthOffering(many, existing)).toHaveLength(MAX_PROPOSALS);
  });

  it('keeps the two documents apart', () => {
    const offered = worthOffering(
      [{ target: 'agent', line: 'Calls their desktop D:/Work', evidence: '"my desktop"' }],
      existing
    );
    // Known in `user.md` says nothing about `agent.md`, which is about the
    // assistant's own work rather than about the person.
    expect(offered).toHaveLength(1);
  });
});

describe('what happens after the user decides', () => {
  const proposal = (line: string, target: 'user' | 'agent' = 'user') => ({
    target,
    line,
    evidence: '"said so"',
  });

  it('writes only what was accepted', () => {
    const verdicts = [
      { proposal: proposal('Kept this.'), accepted: true },
      { proposal: proposal('Not this.'), accepted: false },
    ];

    expect(acceptedLines(verdicts, 'user')).toEqual(['Kept this.']);
  });

  it('writes each line to its own document', () => {
    const verdicts = [
      { proposal: proposal('About them.', 'user'), accepted: true },
      { proposal: proposal('About my work.', 'agent'), accepted: true },
    ];

    expect(acceptedLines(verdicts, 'agent')).toEqual(['About my work.']);
  });

  it('does not offer again what was turned down', () => {
    // Offering the same thing every evening after being told no is not
    // learning, it is nagging.
    expect(alreadyRefused(['Likes jazz.'], 'likes jazz')).toBe(true);
    expect(alreadyRefused(['Likes jazz.'], 'Works in the evenings.')).toBe(false);
  });
});

describe('alreadyKnown', () => {
  it('ignores case and punctuation', () => {
    expect(alreadyKnown('- Calls their desktop D:/Work', 'calls their desktop d work')).toBe(true);
  });

  it('says nothing is known when the line is empty', () => {
    expect(alreadyKnown('anything', '   ')).toBe(false);
  });
});
