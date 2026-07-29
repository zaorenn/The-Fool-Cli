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

  it('replaces streamed chunks for the same message instead of duplicating them', () => {
    const onTurnCompleted = collect([
      { ...base, type: 'text', msg_id: 'm1', data: 'I upd' },
      { ...base, type: 'text', msg_id: 'm1', data: 'I updated the file.' },
      finish,
    ]);

    expect(onTurnCompleted.mock.calls[0][0].answer).toBe('I updated the file.');
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
