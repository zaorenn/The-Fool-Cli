/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { sanitizeForSpeech, truncateToSpokenLength } from './narrationSanitizer';

export type NarrationLanguage = 'tr' | 'en';

/** What actually happened during a turn, gathered from the run, not from prose. */
export type RunEvidence = {
  /** Tool the agent is running right now, if any. */
  activeTool?: string;
  completedTools: readonly string[];
  failedTools: readonly string[];
  /** File names only — never diff bodies. */
  changedFiles: readonly string[];
  /** `unknown` must never be reported as passing. */
  testOutcome: 'passed' | 'failed' | 'unknown';
  unresolvedError?: string;
  requiresUserDecision: boolean;
};

export const EMPTY_EVIDENCE: RunEvidence = {
  completedTools: [],
  failedTools: [],
  changedFiles: [],
  testOutcome: 'unknown',
  requiresUserDecision: false,
};

type Phrases = {
  working: (tool: string) => string;
  changedFiles: (count: number) => string;
  testsPassed: string;
  testsFailed: string;
  toolsFailed: (count: number) => string;
  needsDecision: string;
  nothingToSay: string;
};

const PHRASES: Record<NarrationLanguage, Phrases> = {
  en: {
    working: (tool) => `I'm running ${tool} now.`,
    changedFiles: (count) => (count === 1 ? 'I changed one file.' : `I changed ${count} files.`),
    testsPassed: 'The tests pass.',
    testsFailed: 'The tests fail.',
    toolsFailed: (count) => (count === 1 ? 'One step failed.' : `${count} steps failed.`),
    needsDecision: 'I need a decision from you before I continue.',
    nothingToSay: 'Done.',
  },
  tr: {
    working: (tool) => `Şu an ${tool} çalıştırıyorum.`,
    changedFiles: (count) => (count === 1 ? 'Bir dosyayı değiştirdim.' : `${count} dosyayı değiştirdim.`),
    testsPassed: 'Testler geçiyor.',
    testsFailed: 'Testler başarısız.',
    toolsFailed: (count) => (count === 1 ? 'Bir adım başarısız oldu.' : `${count} adım başarısız oldu.`),
    needsDecision: 'Devam etmeden önce senden bir karar bekliyorum.',
    nothingToSay: 'Bitti.',
  },
};

/**
 * Builds the factual half of the spoken brief.
 *
 * Only states what the evidence supports. An `unknown` test outcome is never
 * upgraded to "passed", because claiming a green suite that was never run is
 * the one failure mode that makes voice reporting worse than silence.
 */
export const describeEvidence = (evidence: RunEvidence, language: NarrationLanguage): string => {
  const phrases = PHRASES[language];
  const parts: string[] = [];

  if (evidence.activeTool) parts.push(phrases.working(evidence.activeTool));
  if (evidence.changedFiles.length > 0) parts.push(phrases.changedFiles(evidence.changedFiles.length));
  if (evidence.testOutcome === 'passed') parts.push(phrases.testsPassed);
  if (evidence.testOutcome === 'failed') parts.push(phrases.testsFailed);
  if (evidence.failedTools.length > 0) parts.push(phrases.toolsFailed(evidence.failedTools.length));
  if (evidence.requiresUserDecision) parts.push(phrases.needsDecision);

  return parts.join(' ');
};

export type NarrationResult = {
  spokenText: string;
  /** `evidence-only` means the assistant's prose held nothing speakable. */
  source: 'answer' | 'evidence' | 'evidence-only' | 'fallback';
};

/**
 * Produces the text the assistant actually speaks.
 *
 * The agent's own answer is sanitized first, so code, diffs, logs, tables,
 * paths, and secrets can never be read aloud. Evidence about what ran is added
 * on top, and if nothing speakable survives, a deterministic phrase is used
 * rather than falling back to raw content.
 */
export const narrate = (
  finalAnswer: string,
  evidence: RunEvidence,
  options: { language: NarrationLanguage; maxSpokenCharacters: number }
): NarrationResult => {
  const spokenAnswer = sanitizeForSpeech(finalAnswer);
  const spokenEvidence = describeEvidence(evidence, options.language);

  if (spokenAnswer.length === 0 && spokenEvidence.length === 0) {
    return { spokenText: PHRASES[options.language].nothingToSay, source: 'fallback' };
  }

  if (spokenAnswer.length === 0) {
    return {
      spokenText: truncateToSpokenLength(spokenEvidence, options.maxSpokenCharacters),
      source: 'evidence-only',
    };
  }

  const combined = spokenEvidence.length > 0 ? `${spokenAnswer} ${spokenEvidence}` : spokenAnswer;
  return {
    spokenText: truncateToSpokenLength(combined, options.maxSpokenCharacters),
    source: spokenEvidence.length > 0 ? 'evidence' : 'answer',
  };
};
