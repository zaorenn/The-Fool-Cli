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
