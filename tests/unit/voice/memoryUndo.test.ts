/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Taking back something the memory learned.
 *
 * The snapshot module was written and tested and called by nothing, so a memory
 * the assistant writes to itself had no undo anywhere in the application — the
 * riskiest combination there is, because a record somebody cannot correct is one
 * they cannot disown. These cover the part the module could not: what happens to
 * the stored list as versions are kept and restored, and what a corrupted one
 * does.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_SNAPSHOTS,
  afterRestoring,
  previousVersion,
  sanitizeSnapshots,
  versionsNewestFirst,
  withSnapshot,
} from '@/common/voice/memorySnapshots';
import type { VoiceMemory } from '@/common/voice/memory';

const memory = (user: string): VoiceMemory => ({ user, agent: '' }) as VoiceMemory;

describe('keeping versions', () => {
  it('keeps the version from before a change', () => {
    const kept = withSnapshot([], memory('before'), 'learned a name');

    expect(previousVersion(kept)?.memory.user).toBe('before');
  });

  it('records why it changed, so a list of versions can be read', () => {
    const kept = withSnapshot([], memory('before'), 'learned a name');

    expect(previousVersion(kept)?.reason).toBe('learned a name');
  });

  it('offers the most recent version first, which is what undo means', () => {
    const kept = withSnapshot(withSnapshot([], memory('one'), 'a'), memory('two'), 'b');

    expect(previousVersion(kept)?.memory.user).toBe('two');
  });

  it('has nothing to offer on a fresh install', () => {
    expect(previousVersion([])).toBeNull();
  });

  it('drops the oldest rather than growing without bound', () => {
    let kept = withSnapshot([], memory('oldest'), 'first');
    for (let index = 0; index < MAX_SNAPSHOTS; index += 1) kept = withSnapshot(kept, memory(`v${index}`), 'more');

    expect(kept).toHaveLength(MAX_SNAPSHOTS);
    expect(kept.some((entry) => entry.memory.user === 'oldest')).toBe(false);
  });

  it('lists versions newest first for a settings page', () => {
    const kept = withSnapshot(withSnapshot([], memory('one'), 'a'), memory('two'), 'b');

    expect(versionsNewestFirst(kept).map((entry) => entry.memory.user)).toEqual(['two', 'one']);
  });
});

describe('restoring', () => {
  it('drops the restored version, so undo is not a loop', () => {
    const kept = withSnapshot(withSnapshot([], memory('one'), 'a'), memory('two'), 'b');

    const left = afterRestoring(kept);

    expect(left).toHaveLength(1);
    expect(previousVersion(left)?.memory.user).toBe('one');
  });

  it('walks back through several changes rather than toggling between two', () => {
    let kept = withSnapshot([], memory('one'), 'a');
    kept = withSnapshot(kept, memory('two'), 'b');
    kept = withSnapshot(kept, memory('three'), 'c');

    const first = previousVersion(kept);
    const afterFirst = afterRestoring(kept);
    const second = previousVersion(afterFirst);

    expect(first?.memory.user).toBe('three');
    expect(second?.memory.user).toBe('two');
  });

  it('ends with nothing left to undo', () => {
    expect(afterRestoring(withSnapshot([], memory('one'), 'a'))).toEqual([]);
  });
});

describe('what comes off disk', () => {
  it('accepts a list it wrote itself', () => {
    const kept = withSnapshot([], memory('before'), 'learned a name');

    expect(sanitizeSnapshots(kept)).toHaveLength(1);
  });

  it('answers an empty list for a value that is not one', () => {
    expect(sanitizeSnapshots(undefined)).toEqual([]);
    expect(sanitizeSnapshots('a string')).toEqual([]);
    expect(sanitizeSnapshots({ memory: {} })).toEqual([]);
  });

  it('drops entries that are not objects rather than the whole list', () => {
    const kept = withSnapshot([], memory('before'), 'a');

    expect(sanitizeSnapshots([...kept, null, 7])).toHaveLength(1);
  });

  it('repairs a missing reason rather than putting undefined on a label', () => {
    expect(sanitizeSnapshots([{ memory: { user: 'x', agent: '' } }])[0].reason).toBe('');
  });

  it('repairs an unusable timestamp, because a version with no date is still worth restoring', () => {
    const repaired = sanitizeSnapshots([{ memory: { user: 'x', agent: '' }, takenAt: 'yesterday' }], 1234);

    expect(repaired[0].takenAt).toBe(1234);
  });

  it('never returns more than it is willing to keep', () => {
    const tooMany = Array.from({ length: MAX_SNAPSHOTS + 5 }, () => ({ memory: { user: 'x', agent: '' } }));

    expect(sanitizeSnapshots(tooMany)).toHaveLength(MAX_SNAPSHOTS);
  });
});
