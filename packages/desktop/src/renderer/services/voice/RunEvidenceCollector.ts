/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { EMPTY_EVIDENCE, type RunEvidence } from './narration/FoolNarrator';

/**
 * A conversation response-stream message, narrowed to the fields the spoken
 * brief is built from. Mirrors `IResponseMessage` without importing the whole
 * bridge surface.
 */
export type StreamMessage = {
  type?: string;
  data?: unknown;
  msg_id?: string;
  turn_id?: string;
  conversation_id?: string;
  status?: 'finish' | 'pending' | 'error' | 'work';
};

export type CompletedTurn = {
  conversationId: string;
  turnId: string;
  answer: string;
  evidence: RunEvidence;
};

const PERMISSION_TYPES = new Set(['acp_permission', 'permission']);
const TEXT_TYPES = new Set(['text', 'content']);

/** Test outcomes are only claimed when the agent's own text states one. */
const PASS_SIGNAL = /\b(all tests? pass(?:ed|ing)?|tests? pass(?:ed|ing)?|suite is green|testler ge[çc]iyor)\b/i;
const FAIL_SIGNAL = /\b(tests? fail(?:ed|ing)?|test failure|suite is red|testler ba[şs]ar[ıi]s[ıi]z)\b/i;

const readText = (data: unknown): string => {
  if (typeof data === 'string') return data;
  if (typeof data === 'object' && data !== null) {
    const record = data as { content?: unknown; text?: unknown };
    if (typeof record.text === 'string') return record.text;
    if (typeof record.content === 'string') return record.content;
    if (typeof record.content === 'object' && record.content !== null) {
      const nested = record.content as { text?: unknown; content?: unknown };
      if (typeof nested.text === 'string') return nested.text;
      if (typeof nested.content === 'string') return nested.content;
    }
  }
  return '';
};

const readToolName = (data: unknown): string => {
  if (typeof data === 'object' && data !== null) {
    const record = data as { name?: unknown; title?: unknown; tool_name?: unknown };
    for (const candidate of [record.name, record.title, record.tool_name]) {
      if (typeof candidate === 'string' && candidate.length > 0) return candidate;
    }
  }
  return 'a tool';
};

type TurnAccumulator = {
  texts: Map<string, string>;
  evidence: RunEvidence;
};

const newAccumulator = (): TurnAccumulator => ({
  texts: new Map(),
  evidence: { ...EMPTY_EVIDENCE, completedTools: [], failedTools: [], changedFiles: [] },
});

/**
 * Turns the conversation stream into the evidence a spoken brief needs.
 *
 * Text is accumulated per `msg_id` so streamed chunks that replace earlier
 * content do not produce duplicated speech. Nothing is spoken from here; the
 * collector only reports a completed turn to its callback.
 */
export const createRunEvidenceCollector = (onTurnCompleted: (turn: CompletedTurn) => void) => {
  const turns = new Map<string, TurnAccumulator>();

  const keyFor = (message: StreamMessage) => `${message.conversation_id ?? ''}:${message.turn_id ?? ''}`;

  const onStreamMessage = (message: StreamMessage): void => {
    if (!message?.type) return;

    const key = keyFor(message);
    let turn = turns.get(key);
    if (!turn) {
      turn = newAccumulator();
      turns.set(key, turn);
    }

    if (PERMISSION_TYPES.has(message.type)) {
      turn.evidence = { ...turn.evidence, requiresUserDecision: true };
      return;
    }

    if (TEXT_TYPES.has(message.type)) {
      const text = readText(message.data);
      if (text.length > 0) turn.texts.set(message.msg_id ?? String(turn.texts.size), text);
      return;
    }

    if (message.type === 'tool_call') {
      const name = readToolName(message.data);
      if (message.status === 'error') {
        turn.evidence = { ...turn.evidence, failedTools: [...turn.evidence.failedTools, name], activeTool: undefined };
      } else if (message.status === 'finish') {
        turn.evidence = {
          ...turn.evidence,
          completedTools: [...turn.evidence.completedTools, name],
          activeTool: undefined,
        };
      } else {
        turn.evidence = { ...turn.evidence, activeTool: name };
      }
      return;
    }

    if (message.type !== 'finish') return;

    turns.delete(key);
    const answer = [...turn.texts.values()].join('\n').trim();
    const evidence: RunEvidence = {
      ...turn.evidence,
      activeTool: undefined,
      testOutcome: FAIL_SIGNAL.test(answer) ? 'failed' : PASS_SIGNAL.test(answer) ? 'passed' : 'unknown',
    };

    onTurnCompleted({
      conversationId: message.conversation_id ?? '',
      turnId: message.turn_id ?? '',
      answer,
      evidence,
    });
  };

  /** Drops accumulated state, e.g. when the voice session closes. */
  const reset = (): void => {
    turns.clear();
  };

  return { onStreamMessage, reset };
};
