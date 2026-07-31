/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_EVIDENCE,
  describeEvidence,
  narrate,
  type RunEvidence,
} from '@renderer/services/voice/narration/FoolNarrator';

const options = { language: 'en' as const, maxSpokenCharacters: 600 };
const evidence = (over: Partial<RunEvidence> = {}): RunEvidence => ({ ...EMPTY_EVIDENCE, ...over });

describe('describeEvidence', () => {
  it('reports what is running right now', () => {
    expect(describeEvidence(evidence({ activeTool: 'the test suite' }), 'en')).toBe("I'm running the test suite now.");
  });

  it('reports the same in Turkish', () => {
    expect(describeEvidence(evidence({ activeTool: 'testler' }), 'tr')).toBe('Şu an testler çalıştırıyorum.');
  });

  it('counts changed files without naming their paths', () => {
    const spoken = describeEvidence(evidence({ changedFiles: ['a.ts', 'b.ts'] }), 'en');

    expect(spoken).toBe('I changed 2 files.');
    expect(spoken).not.toContain('a.ts');
  });

  it('never claims tests passed when the outcome is unknown', () => {
    const spoken = describeEvidence(evidence({ changedFiles: ['a.ts'], testOutcome: 'unknown' }), 'en');

    expect(spoken).not.toContain('pass');
  });

  it('reports a failing suite as failing', () => {
    expect(describeEvidence(evidence({ testOutcome: 'failed' }), 'en')).toContain('fail');
  });

  it('reports failed steps and a pending decision', () => {
    const spoken = describeEvidence(evidence({ failedTools: ['build'], requiresUserDecision: true }), 'en');

    expect(spoken).toContain('One step failed.');
    expect(spoken).toContain('decision');
  });

  it('says nothing when there is no evidence', () => {
    expect(describeEvidence(EMPTY_EVIDENCE, 'en')).toBe('');
  });
});

describe('narrate', () => {
  it('speaks the answer but never the code inside it', () => {
    const result = narrate('I fixed it.\n```ts\nconst x = 1;\n```', EMPTY_EVIDENCE, options);

    expect(result.spokenText).toContain('I fixed it.');
    expect(result.spokenText).not.toContain('const x');
    expect(result.source).toBe('answer');
  });

  it('appends evidence to the spoken answer', () => {
    const result = narrate('Login validation is corrected.', evidence({ testOutcome: 'passed' }), options);

    expect(result.spokenText).toBe('Login validation is corrected. The tests pass.');
    expect(result.source).toBe('evidence');
  });

  it('falls back to evidence when the answer is entirely code', () => {
    const result = narrate('```\nrm -rf build\n```', evidence({ changedFiles: ['a.ts'] }), options);

    expect(result.spokenText).toBe('I changed one file.');
    expect(result.source).toBe('evidence-only');
  });

  it('uses a deterministic phrase rather than raw content when nothing is speakable', () => {
    const result = narrate('```\nconst a = 1;\n```', EMPTY_EVIDENCE, options);

    expect(result.spokenText).toBe('Done.');
    expect(result.source).toBe('fallback');
  });

  it('respects the spoken length limit', () => {
    const long = `${'This is a complete sentence. '.repeat(60)}`;

    expect(
      narrate(long, EMPTY_EVIDENCE, { ...options, maxSpokenCharacters: 100 }).spokenText.length
    ).toBeLessThanOrEqual(100);
  });

  it('never reads a tool log even when the agent pasted one', () => {
    const result = narrate(
      'Here is the run:\nRunning: bun test\nExit code: 1\nstderr: boom\nI will retry.',
      EMPTY_EVIDENCE,
      options
    );

    expect(result.spokenText).not.toContain('Exit code');
    expect(result.spokenText).not.toContain('stderr');
    expect(result.spokenText).toContain('I will retry.');
  });
});
