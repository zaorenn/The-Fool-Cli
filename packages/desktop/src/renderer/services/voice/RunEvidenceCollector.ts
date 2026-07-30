/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mergeTextMessageContent, normalizeTextMessageContent } from '@/common/chat/chatLib';
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
  /** Replaces the text accumulated for this `msg_id` instead of adding to it. */
  replace?: boolean;
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

/**
 * The assembled body of one streamed message, exactly as the chat assembles it.
 *
 * Read through `chatLib` rather than re-read here, because these two disagreeing
 * is the bug this collector had: a reply arrives as deltas — each chunk the next
 * few words of the same `msg_id` — and keeping only the newest chunk left the
 * spoken answer as whatever happened to arrive last. A fragment, usually; nothing
 * at all when the sanitiser then removed a chunk that was only punctuation. The
 * read-aloud button takes the finished message off the screen, which is why it
 * alone was never affected.
 */
type TextContent = ReturnType<typeof normalizeTextMessageContent>;

/**
 * Where chunks that carry no `msg_id` accumulate.
 *
 * One bucket rather than one per chunk, because the chat merges them into a
 * single message too: with no id to tell them apart, consecutive chunks are the
 * same message by definition.
 */
const UNIDENTIFIED_MESSAGE = '';

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
  texts: Map<string, TextContent>;
  evidence: RunEvidence;
  /** The last turn id seen here, so a new one can start the bucket over. */
  turnId: string | null;
};

const newAccumulator = (turnId: string | null = null): TurnAccumulator => ({
  texts: new Map(),
  evidence: { ...EMPTY_EVIDENCE, completedTools: [], failedTools: [], changedFiles: [] },
  turnId,
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

  /**
   * Everything in one conversation accumulates together, turn id or not.
   *
   * `turn_id` is optional on the stream, and in practice the text chunks and the
   * message that ends the turn do not always carry the same one — so keying on
   * it dropped the reply into one bucket and then read the answer out of an
   * empty one. The spoken brief came back with no text at all, and the narrator,
   * left with nothing but the evidence, said "Done." That is the whole of the
   * one-word answer that sounded like a cut-off reply.
   *
   * Keying on the conversation cannot miss: each completion consumes whatever
   * arrived since the last one, which is exactly the turn that just finished.
   */
  const keyFor = (message: StreamMessage) => message.conversation_id ?? '';

  const onStreamMessage = (message: StreamMessage): void => {
    if (!message?.type) return;

    const key = keyFor(message);
    const turnId = message.turn_id ?? null;
    let turn = turns.get(key);
    // A turn id that has changed means the previous turn ended without ever
    // saying so; whatever it left behind is not part of this answer. A stream
    // that sends no turn ids simply never trips this, which is the point.
    if (turn && turnId !== null && turn.turnId !== null && turn.turnId !== turnId) turn = undefined;
    if (!turn) {
      turn = newAccumulator(turnId);
      turns.set(key, turn);
    } else if (turn.turnId === null && turnId !== null) {
      turn.turnId = turnId;
    }

    if (PERMISSION_TYPES.has(message.type)) {
      turn.evidence = { ...turn.evidence, requiresUserDecision: true };
      return;
    }

    if (TEXT_TYPES.has(message.type)) {
      const incoming = normalizeTextMessageContent(message.data, { replace: message.replace === true });
      const key = message.msg_id ?? UNIDENTIFIED_MESSAGE;
      const existing = turn.texts.get(key);
      turn.texts.set(key, existing ? mergeTextMessageContent(existing, incoming) : incoming);
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
    const answer = [...turn.texts.values()]
      .map((content) => content.content)
      .filter((text) => text.length > 0)
      .join('\n')
      .trim();
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
