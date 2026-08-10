/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { foldTitle } from './pendingAnswer';

/**
 * Something the assistant thinks it learned, offered rather than written.
 *
 * The memory improves by itself today only in the sense that a model writes to
 * it whenever it decides to. Nothing reviews a finished conversation, nothing
 * records *why* a line is there, and nothing can be argued with afterwards.
 *
 * A proposal is the opposite of that in three specific ways, and each is a
 * property this module enforces rather than a hope.
 *
 * **It carries its evidence.** A line the user cannot trace is a line they
 * cannot disagree with, and one they cannot disagree with is one that quietly
 * becomes true.
 *
 * **It is never applied without a yes.** The most damaging thing a memory can
 * do is be confidently wrong about somebody, and a model that has decided it
 * learned something will write it with exactly as much confidence either way.
 *
 * **It refuses to repeat what is already known.** A loop that proposes the same
 * fact every evening teaches the user to approve without reading, which is the
 * same failure as asking permission for everything.
 */

export type MemoryProposal = {
  /** Which document it belongs in. */
  target: 'user' | 'agent';
  /** The line as it would be written. */
  line: string;
  /** What in the conversation suggests it, quoted rather than summarised. */
  evidence: string;
};

/** The most that is offered at the end of one conversation. */
export const MAX_PROPOSALS = 5;

/**
 * Whether the memory already says this.
 *
 * Folded before comparing, because "Calls their desktop D:/Work" and "calls
 * their desktop d:/work" are the same sentence and offering both is how a
 * memory becomes a list of near-duplicates nobody reads.
 */
export const alreadyKnown = (document: string, line: string): boolean => {
  const known = foldTitle(document);
  const candidate = foldTitle(line);
  return candidate.length > 0 && known.includes(candidate);
};

/**
 * The proposals worth showing, out of whatever was suggested.
 *
 * Empty lines and lines without evidence are dropped rather than shown with a
 * blank justification: a proposal that cannot say why it exists is one the user
 * has no way to judge, and showing it teaches them to approve blindly.
 */
export const worthOffering = (
  proposals: readonly MemoryProposal[],
  memory: { user: string; agent: string }
): MemoryProposal[] => {
  const kept: MemoryProposal[] = [];

  for (const proposal of proposals) {
    const line = proposal.line.trim();
    const evidence = proposal.evidence.trim();
    if (line.length === 0 || evidence.length === 0) continue;

    const document = proposal.target === 'user' ? memory.user : memory.agent;
    if (alreadyKnown(document, line)) continue;
    if (kept.some((other) => other.target === proposal.target && alreadyKnown(other.line, line))) continue;

    kept.push({ target: proposal.target, line, evidence });
    if (kept.length >= MAX_PROPOSALS) break;
  }

  return kept;
};

/**
 * What a proposal looks like once the user has decided.
 *
 * Rejections are kept rather than discarded: a loop that offers the same thing
 * every evening after being told no twice is not learning, it is nagging.
 */
export type ProposalVerdict = { proposal: MemoryProposal; accepted: boolean };

/** The lines to write, in the order they were offered. */
export const acceptedLines = (verdicts: readonly ProposalVerdict[], target: 'user' | 'agent'): string[] =>
  verdicts
    .filter((verdict) => verdict.accepted && verdict.proposal.target === target)
    .map((verdict) => verdict.proposal.line);

/**
 * Whether this has already been turned down.
 *
 * Checked before offering, so being told no means something.
 */
export const alreadyRefused = (refused: readonly string[], line: string): boolean =>
  refused.some((earlier) => alreadyKnown(earlier, line) || alreadyKnown(line, earlier));

/**
 * What to ask a model at the end of a conversation.
 *
 * This is the half that was missing. The machinery above has been able to
 * filter, de-duplicate and record proposals since it was written, and nothing
 * ever produced one — so the memory only grew when a model happened to call
 * `app_remember` mid-sentence, which a small local model almost never does.
 * What the user experienced was an assistant that had a memory and did not use
 * it: the same stranger, every evening, with a list of session lines behind it.
 *
 * Four rules, and each one is here because the obvious prompt breaks it:
 *
 * **Only what they said about themselves.** Not what the assistant did, not
 * what was discussed. "They are learning German" is a fact about a person;
 * "we talked about German" is what the session line is already for.
 *
 * **Evidence, quoted.** A line the user cannot trace is a line they cannot
 * argue with, and one they cannot argue with quietly becomes true.
 *
 * **Nothing, when there is nothing.** A model asked for five facts will invent
 * five facts. Being told that an empty list is the usual answer is what stops
 * a quiet evening becoming five confident sentences about somebody.
 *
 * **English, whatever was spoken.** These are read back into a prompt, not to
 * a person — the same reason the session summary is in English.
 */
export const MEMORY_REVIEW_PROMPT = `You have just finished a spoken conversation. Look back at it and list only the things you learned about the person that would still be true next week.

Answer with a JSON array and nothing else. Each item is {"line": "...", "evidence": "..."}.

- \`line\` is one short sentence about them, in English, written the way a note to yourself would be: "Plays guitar." "Calls their work folder the project." "Prefers short answers."
- \`evidence\` is a short quote of what they actually said that shows it, in their own words and language.
- Only lasting things about the person: what they are called, what they do, what they like and dislike, what their own words mean, how they want to be spoken to.
- Not what happened in this conversation, not what you did, not anything you inferred without being told.
- If they said nothing lasting about themselves, answer with []. That is the usual answer and it is the right one.
- At most five items.`;

/**
 * The proposals in a model's reply, however it chose to wrap them.
 *
 * Tolerant on the way in and strict on the way out. These models put JSON in
 * fenced blocks, add a sentence in front of it, and occasionally answer with a
 * bare object instead of an array — none of which is worth losing a real
 * observation over. What is *not* tolerated is a proposal without evidence or
 * without a line, because the whole design rests on both being there.
 *
 * Everything lands in `user`: this asks only for facts about the person, and a
 * model choosing which of the two documents to write to is a decision it has no
 * basis for making.
 */
export const readProposals = (reply: string): MemoryProposal[] => {
  const text = reply.trim();
  if (text.length === 0) return [];

  // The first bracketed run, so a sentence before it or a fence around it does
  // not cost the whole answer.
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  const json = start >= 0 && end > start ? text.slice(start, end + 1) : text;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }

  const items = Array.isArray(parsed) ? parsed : [parsed];
  const kept: MemoryProposal[] = [];
  for (const item of items) {
    if (item === null || typeof item !== 'object') continue;
    const record = item as { line?: unknown; evidence?: unknown };
    if (typeof record.line !== 'string' || typeof record.evidence !== 'string') continue;

    const line = record.line.trim();
    const evidence = record.evidence.trim();
    if (line.length === 0 || evidence.length === 0) continue;

    kept.push({ target: 'user', line, evidence });
    if (kept.length >= MAX_PROPOSALS) break;
  }
  return kept;
};

/** Where the pending proposals and the refused lines are kept. */
export const MEMORY_PROPOSALS_CONFIG_KEY = 'voice.memoryProposals';
export const MEMORY_REFUSALS_CONFIG_KEY = 'voice.memoryRefusals';

/**
 * How many refusals are remembered.
 *
 * Bounded, but generously: being told no has to keep meaning no, and a list
 * that forgets is a list that starts offering the same thing again. Fifty is
 * far more than anybody rejects.
 */
export const MAX_REFUSALS = 50;

/** The pending proposals as they can be trusted, from whatever was stored. */
export const sanitizeProposals = (value: unknown): MemoryProposal[] => {
  if (!Array.isArray(value)) return [];

  const kept: MemoryProposal[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') continue;
    const record = entry as { target?: unknown; line?: unknown; evidence?: unknown };
    if (typeof record.line !== 'string' || typeof record.evidence !== 'string') continue;
    if (record.target !== 'user' && record.target !== 'agent') continue;

    const line = record.line.trim();
    const evidence = record.evidence.trim();
    if (line.length === 0 || evidence.length === 0) continue;

    kept.push({ target: record.target, line, evidence });
  }
  return kept;
};

/** The refused lines as they can be trusted, newest first and bounded. */
export const sanitizeRefusals = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim())
    .slice(0, MAX_REFUSALS);
};
