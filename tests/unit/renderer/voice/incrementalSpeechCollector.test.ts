/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { createIncrementalSpeechCollector } from '@renderer/services/voice/IncrementalSpeechCollector';

const textDelta = (content: string, overrides: Record<string, unknown> = {}) => ({
  type: 'text',
  conversation_id: 'c1',
  turn_id: 't1',
  msg_id: 'm1',
  data: content,
  ...overrides,
});

describe('createIncrementalSpeechCollector', () => {
  it('speaks a sentence as soon as it completes, before the turn finishes', () => {
    const onSentence = vi.fn();
    const collector = createIncrementalSpeechCollector(onSentence, vi.fn(), 1200);

    collector.onStreamMessage(textDelta('The answer is forty-two. And '));

    expect(onSentence).toHaveBeenCalledWith('The answer is forty-two.');
  });

  it('flushes trailing text with no terminator when the turn finishes, then reports done', () => {
    const onSentence = vi.fn();
    const onDone = vi.fn();
    const collector = createIncrementalSpeechCollector(onSentence, onDone, 1200);

    collector.onStreamMessage(textDelta('No ending here'));
    collector.onStreamMessage({ type: 'finish', conversation_id: 'c1', turn_id: 't1' });

    expect(onSentence).toHaveBeenCalledWith('No ending here');
    expect(onDone).toHaveBeenCalledWith('c1', 't1');
  });

  it('stops emitting once the character cap is reached, mid-turn', () => {
    const onSentence = vi.fn();
    const collector = createIncrementalSpeechCollector(onSentence, vi.fn(), 10);

    collector.onStreamMessage(textDelta('Short one. '));
    collector.onStreamMessage(textDelta('This one pushes well past the cap. '));

    expect(onSentence).toHaveBeenCalledWith('Short one.');
    expect(onSentence).toHaveBeenCalledTimes(1);
  });

  it('reassembles deltas for the same msg_id the same way RunEvidenceCollector does', () => {
    const onSentence = vi.fn();
    const collector = createIncrementalSpeechCollector(onSentence, vi.fn(), 1200);

    collector.onStreamMessage(textDelta('The an'));
    collector.onStreamMessage(textDelta('swer is forty-two.', { msg_id: 'm1' }));

    expect(onSentence).toHaveBeenCalledWith('The answer is forty-two.');
  });

  it('sanitizes each emitted sentence before handing it out', () => {
    const onSentence = vi.fn();
    const collector = createIncrementalSpeechCollector(onSentence, vi.fn(), 1200);

    collector.onStreamMessage(textDelta('Run `npm test` to check. '));

    expect(onSentence).toHaveBeenCalledWith(expect.not.stringContaining('`'));
  });

  it('reset drops accumulated state for a fresh turn', () => {
    const onSentence = vi.fn();
    const collector = createIncrementalSpeechCollector(onSentence, vi.fn(), 1200);
    collector.onStreamMessage(textDelta('Half a sentence'));

    collector.reset();
    collector.onStreamMessage(textDelta('finishes it now.'));

    // Nothing carried over from before reset — "finishes it now." on its own
    // has no capital start, but the point under test is that "Half a
    // sentence" never gets glued onto it.
    expect(onSentence).not.toHaveBeenCalledWith(expect.stringContaining('Half a sentence finishes'));
  });

  // RunEvidenceCollector explicitly supports more than one text msg_id in a
  // single turn (its own `texts` map is keyed by msg_id, joined only at the
  // very end) — a reasoning stream sending "thinking" under one msg_id and
  // "answer" under another is exactly this shape. Interleaved delivery must
  // not glue one message's fragment onto another's.
  it('keeps two interleaved messages in the same turn from bleeding into each other', () => {
    const onSentence = vi.fn();
    const collector = createIncrementalSpeechCollector(onSentence, vi.fn(), 1200);

    collector.onStreamMessage(textDelta('The weather in Paris is', { msg_id: 'thinking' }));
    collector.onStreamMessage(textDelta('Quick note.', { msg_id: 'answer' }));
    collector.onStreamMessage(textDelta(' nice today.', { msg_id: 'thinking' }));
    collector.onStreamMessage({ type: 'finish', conversation_id: 'c1', turn_id: 't1' });

    const spoken = onSentence.mock.calls.map((call) => call[0]);
    expect(spoken).toContain('Quick note.');
    expect(spoken).toContain('The weather in Paris is nice today.');
    // Neither message's text may appear fused into the other's.
    expect(spoken.some((s) => s.includes('Quick') && s.includes('Paris'))).toBe(false);
  });

  it('handles a replace delta without mis-speaking the corrected text', () => {
    const onSentence = vi.fn();
    const collector = createIncrementalSpeechCollector(onSentence, vi.fn(), 1200);

    collector.onStreamMessage(textDelta('Wrong answer.'));
    collector.onStreamMessage(textDelta('Corrected answer is forty-two.', { replace: true }));
    collector.onStreamMessage({ type: 'finish', conversation_id: 'c1', turn_id: 't1' });

    const spoken = onSentence.mock.calls.map((call) => call[0]).join(' ');
    expect(spoken).not.toContain('Wrong');
    expect(spoken).toContain('Corrected answer is forty-two.');
  });
});
