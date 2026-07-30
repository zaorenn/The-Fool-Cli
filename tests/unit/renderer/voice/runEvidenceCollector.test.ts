/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { createRunEvidenceCollector, type StreamMessage } from '@renderer/services/voice/RunEvidenceCollector';

const base = { conversation_id: 'c1', turn_id: 't1' };
const finish: StreamMessage = { ...base, type: 'finish' };

const collect = (messages: StreamMessage[]) => {
  const onTurnCompleted = vi.fn();
  const collector = createRunEvidenceCollector(onTurnCompleted);
  for (const message of messages) collector.onStreamMessage(message);
  return onTurnCompleted;
};

describe('createRunEvidenceCollector', () => {
  it('reports the accumulated answer when the turn finishes', () => {
    const onTurnCompleted = collect([
      { ...base, type: 'text', msg_id: 'm1', data: 'I updated the login form.' },
      finish,
    ]);

    expect(onTurnCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ answer: 'I updated the login form.', conversationId: 'c1', turnId: 't1' })
    );
  });

  // The stream sends an answer as deltas: each chunk is the next piece of the
  // same message, and the chat appends them. Overwriting instead left the spoken
  // answer as whatever the last chunk happened to be — a few words, or nothing at
  // all once the sanitiser had removed a trailing punctuation-only chunk. That is
  // the whole of "it reads a fragment, or stays silent" while the read-aloud
  // button, which takes the assembled message off the screen, always worked.
  it('appends streamed chunks for the same message', () => {
    const onTurnCompleted = collect([
      { ...base, type: 'text', msg_id: 'm1', data: 'I updated ' },
      { ...base, type: 'text', msg_id: 'm1', data: 'the login form ' },
      { ...base, type: 'text', msg_id: 'm1', data: 'and the tests.' },
      finish,
    ]);

    expect(onTurnCompleted.mock.calls[0][0].answer).toBe('I updated the login form and the tests.');
  });

  it('replaces the accumulated text when the chunk says to', () => {
    const onTurnCompleted = collect([
      { ...base, type: 'text', msg_id: 'm1', data: 'I upd' },
      { ...base, type: 'text', msg_id: 'm1', data: 'I updated the file.', replace: true },
      finish,
    ]);

    expect(onTurnCompleted.mock.calls[0][0].answer).toBe('I updated the file.');
  });

  it('honours a replace flag carried inside the payload', () => {
    const onTurnCompleted = collect([
      { ...base, type: 'text', msg_id: 'm1', data: 'partial' },
      { ...base, type: 'text', msg_id: 'm1', data: { content: 'The whole answer.', replace: true } },
      finish,
    ]);

    expect(onTurnCompleted.mock.calls[0][0].answer).toBe('The whole answer.');
  });

  // A chunk whose payload arrives as JSON was being spoken verbatim, braces and
  // field names included.
  it('reads the text out of a JSON payload rather than speaking the envelope', () => {
    const onTurnCompleted = collect([
      { ...base, type: 'text', msg_id: 'm1', data: JSON.stringify({ content: 'Hello there.' }) },
      finish,
    ]);

    expect(onTurnCompleted.mock.calls[0][0].answer).toBe('Hello there.');
  });

  it('keeps two streamed messages of one turn in arrival order', () => {
    const onTurnCompleted = collect([
      { ...base, type: 'text', msg_id: 'm1', data: 'First half. ' },
      { ...base, type: 'text', msg_id: 'm2', data: 'Second ' },
      { ...base, type: 'text', msg_id: 'm1', data: 'Still first.' },
      { ...base, type: 'text', msg_id: 'm2', data: 'half.' },
      finish,
    ]);

    expect(onTurnCompleted.mock.calls[0][0].answer).toBe('First half. Still first.\nSecond half.');
  });

  it('records a completed tool without treating it as failed', () => {
    const onTurnCompleted = collect([
      { ...base, type: 'tool_call', status: 'finish', data: { name: 'read_file' } },
      finish,
    ]);
    const { evidence } = onTurnCompleted.mock.calls[0][0];

    expect(evidence.completedTools).toEqual(['read_file']);
    expect(evidence.failedTools).toEqual([]);
  });

  it('records a failed tool', () => {
    const onTurnCompleted = collect([
      { ...base, type: 'tool_call', status: 'error', data: { name: 'run_tests' } },
      finish,
    ]);

    expect(onTurnCompleted.mock.calls[0][0].evidence.failedTools).toEqual(['run_tests']);
  });

  it('clears the active tool once the turn ends', () => {
    const onTurnCompleted = collect([
      { ...base, type: 'tool_call', status: 'work', data: { name: 'run_tests' } },
      finish,
    ]);

    expect(onTurnCompleted.mock.calls[0][0].evidence.activeTool).toBeUndefined();
  });

  it('flags a pending permission request as needing a decision', () => {
    const onTurnCompleted = collect([{ ...base, type: 'acp_permission' }, finish]);

    expect(onTurnCompleted.mock.calls[0][0].evidence.requiresUserDecision).toBe(true);
  });

  it('never claims tests passed when the answer does not say so', () => {
    const onTurnCompleted = collect([{ ...base, type: 'text', msg_id: 'm1', data: 'I changed two files.' }, finish]);

    expect(onTurnCompleted.mock.calls[0][0].evidence.testOutcome).toBe('unknown');
  });

  it('reads a passing suite from the answer', () => {
    const onTurnCompleted = collect([{ ...base, type: 'text', msg_id: 'm1', data: 'Done. All tests pass.' }, finish]);

    expect(onTurnCompleted.mock.calls[0][0].evidence.testOutcome).toBe('passed');
  });

  it('prefers a failure signal over a passing one', () => {
    const onTurnCompleted = collect([
      { ...base, type: 'text', msg_id: 'm1', data: 'Some tests pass but two tests failed.' },
      finish,
    ]);

    expect(onTurnCompleted.mock.calls[0][0].evidence.testOutcome).toBe('failed');
  });

  it('keeps separate turns apart', () => {
    const onTurnCompleted = vi.fn();
    const collector = createRunEvidenceCollector(onTurnCompleted);

    collector.onStreamMessage({ conversation_id: 'c1', turn_id: 'a', type: 'text', msg_id: 'm1', data: 'First.' });
    collector.onStreamMessage({ conversation_id: 'c1', turn_id: 'b', type: 'text', msg_id: 'm2', data: 'Second.' });
    collector.onStreamMessage({ conversation_id: 'c1', turn_id: 'b', type: 'finish' });

    expect(onTurnCompleted.mock.calls[0][0].answer).toBe('Second.');
  });

  // `turn_id` is optional on the stream, and the text chunks and the message
  // that ends the turn do not always carry the same one. Keying on it read the
  // answer out of an empty bucket, so the narrator was handed no text at all
  // and said "Done." — a one-word reply that sounded like a cut-off one.
  it('collects an answer from a stream that sends no turn ids', () => {
    const onTurnCompleted = vi.fn();
    const collector = createRunEvidenceCollector(onTurnCompleted);

    collector.onStreamMessage({ conversation_id: 'c1', type: 'text', msg_id: 'm1', data: 'Hello there.' });
    collector.onStreamMessage({ conversation_id: 'c1', type: 'finish' });

    expect(onTurnCompleted.mock.calls[0][0].answer).toBe('Hello there.');
  });

  it('collects it when only the ending message carries a turn id', () => {
    const onTurnCompleted = vi.fn();
    const collector = createRunEvidenceCollector(onTurnCompleted);

    collector.onStreamMessage({ conversation_id: 'c1', type: 'text', msg_id: 'm1', data: 'Hello there.' });
    collector.onStreamMessage({ conversation_id: 'c1', turn_id: 'a', type: 'finish' });

    expect(onTurnCompleted.mock.calls[0][0].answer).toBe('Hello there.');
  });

  it('collects it when only the text carries a turn id', () => {
    const onTurnCompleted = vi.fn();
    const collector = createRunEvidenceCollector(onTurnCompleted);

    collector.onStreamMessage({ conversation_id: 'c1', turn_id: 'a', type: 'text', msg_id: 'm1', data: 'Hello.' });
    collector.onStreamMessage({ conversation_id: 'c1', type: 'finish' });

    expect(onTurnCompleted.mock.calls[0][0].answer).toBe('Hello.');
  });

  it('starts the next turn clean, so one answer never carries the last one', () => {
    const onTurnCompleted = vi.fn();
    const collector = createRunEvidenceCollector(onTurnCompleted);

    collector.onStreamMessage({ conversation_id: 'c1', type: 'text', msg_id: 'm1', data: 'First.' });
    collector.onStreamMessage({ conversation_id: 'c1', type: 'finish' });
    collector.onStreamMessage({ conversation_id: 'c1', type: 'text', msg_id: 'm2', data: 'Second.' });
    collector.onStreamMessage({ conversation_id: 'c1', type: 'finish' });

    expect(onTurnCompleted.mock.calls[1][0].answer).toBe('Second.');
  });

  it('keeps two conversations apart', () => {
    const onTurnCompleted = vi.fn();
    const collector = createRunEvidenceCollector(onTurnCompleted);

    collector.onStreamMessage({ conversation_id: 'c1', type: 'text', msg_id: 'm1', data: 'Mine.' });
    collector.onStreamMessage({ conversation_id: 'c2', type: 'text', msg_id: 'm2', data: 'Theirs.' });
    collector.onStreamMessage({ conversation_id: 'c1', type: 'finish' });

    expect(onTurnCompleted.mock.calls[0][0].answer).toBe('Mine.');
  });

  it('ignores a message with no type', () => {
    const onTurnCompleted = collect([{ ...base }, finish]);

    expect(onTurnCompleted).toHaveBeenCalledTimes(1);
  });

  it('stops reporting after reset', () => {
    const onTurnCompleted = vi.fn();
    const collector = createRunEvidenceCollector(onTurnCompleted);

    collector.onStreamMessage({ ...base, type: 'text', msg_id: 'm1', data: 'Buffered.' });
    collector.reset();
    collector.onStreamMessage(finish);

    expect(onTurnCompleted.mock.calls[0][0].answer).toBe('');
  });
});
