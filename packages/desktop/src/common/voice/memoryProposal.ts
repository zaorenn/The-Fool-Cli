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

// ───────────────────────────────────────────────────────────────────────────
// Wanting to know something.
//
// Everything above is the assistant *reviewing* a conversation that happened.
// This is the other direction: noticing that something worth knowing is missing
// and deciding whether now is a moment to ask about it.
//
// The distinction is the whole design. Reviewing is free — nobody is
// interrupted by it, and the user sees the result in Settings when they choose
// to. Asking spends something: their attention, and a little of their patience
// each time. So a review may happen after every conversation, and a question
// has a budget.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Something worth knowing about a person.
 *
 * Not a questionnaire. The list is what makes an answer *worth having* — a
 * handful of things that change how every later turn goes — and the question
 * itself is never scripted from it: what to say comes from the conversation
 * that has just happened, and this only decides whether there is a gap to ask
 * into at all.
 *
 * Kept short on purpose. A longer list is a longer interrogation, and the
 * failure it produces is the one nobody forgives: an assistant that treats a
 * person as a form to be completed.
 */
export type Knowable = {
  /** Stable, because a refusal is remembered against it for good. */
  id: string;
  /**
   * Words whose presence in the memory means this is already answered.
   *
   * Matched against the folded document, so a note written in any casing or with
   * any punctuation still counts. Generous rather than exact: the cost of
   * deciding something is known when it is only nearly known is one question not
   * asked, and the cost of the other mistake is a question the user has already
   * answered — which is the thing that makes people stop talking to it.
   */
  answeredBy: readonly string[];
};

export const WORTH_KNOWING: readonly Knowable[] = [
  { id: 'name', answeredBy: ['called', 'name is', 'calls themselves', 'address them'] },
  { id: 'work', answeredBy: ['works', 'works as', 'job', 'builds', 'studies'] },
  { id: 'hours', answeredBy: ['evenings', 'mornings', 'works at night', 'hours', 'weekends'] },
  { id: 'project', answeredBy: ['project', 'working on', 'repo', 'the app they'] },
  { id: 'register', answeredBy: ['prefers short', 'prefers long', 'formal', 'informal', 'spoken to'] },
  // Not a preference like the others: a thing they never want read out loud.
  // It is on the list because getting it wrong is the one that is remembered —
  // an address said aloud in a room with other people in it cannot be taken
  // back, and the memory already carries a rule of exactly this shape.
  { id: 'never-aloud', answeredBy: ['never read', 'do not read', 'not out loud', 'aloud'] },
];

/**
 * The gaps: things worth knowing that the memory does not answer.
 *
 * A subject that has been refused is not a gap. That is the difference between
 * "I do not know this" and "I have been told not to ask", and treating them the
 * same is how an assistant comes to ask the same unwelcome question every week.
 */
export const openSubjects = (
  memory: { user: string; agent: string },
  refusedSubjects: readonly string[] = []
): Knowable[] => {
  const known = foldTitle(`${memory.user}\n${memory.agent}`);
  const refused = new Set(refusedSubjects);
  return WORTH_KNOWING.filter(
    (subject) => !refused.has(subject.id) && !subject.answeredBy.some((phrase) => known.includes(foldTitle(phrase)))
  );
};

/** How many questions one conversation may ask. */
export const QUESTIONS_PER_SESSION = 1;

/** What decides whether a question can be asked now. */
export type AskingMoment = {
  /** The subject this question would be about. */
  subject: string;
  /** How many have already been asked this session. */
  askedThisSession: number;
  /**
   * Whether something is being worked on right now.
   *
   * The single most important of these. A question in the middle of a task is
   * not curiosity, it is an interruption of the thing the user actually asked
   * for, and it is remembered as the assistant not paying attention.
   */
  midTask: boolean;
  /** Subjects the user has declined. Refused once is refused for good. */
  refusedSubjects: ReadonlySet<string>;
};

/**
 * Whether the assistant may ask about this now.
 *
 * Composed with `maySpeakUnprompted` rather than duplicating it: that decides
 * whether speaking unasked is acceptable at this moment at all, and this decides
 * whether *a question* is, which is a stricter thing. Both have to say yes.
 */
export const mayAskAbout = (moment: AskingMoment): boolean => {
  if (moment.midTask) return false;
  if (moment.refusedSubjects.has(moment.subject)) return false;
  return moment.askedThisSession < QUESTIONS_PER_SESSION;
};

/** Where the refused subjects and the session's question count are kept. */
export const CURIOSITY_REFUSALS_CONFIG_KEY = 'voice.curiosityRefusals';

/**
 * The refused subjects as they can be trusted.
 *
 * Only ids that are still on the list, so a subject removed from
 * {@link WORTH_KNOWING} does not leave a refusal behind that nothing can ever
 * clear — and so a corrupted store cannot suppress a question by naming
 * something that was never a subject.
 */
export const sanitizeRefusedSubjects = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const known = new Set(WORTH_KNOWING.map((subject) => subject.id));
  return [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && known.has(entry)))];
};
