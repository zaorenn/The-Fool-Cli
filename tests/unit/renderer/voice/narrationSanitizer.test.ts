/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { sanitizeForSpeech, truncateToSpokenLength } from '@renderer/services/voice/narration/narrationSanitizer';

describe('sanitizeForSpeech', () => {
  it('never speaks a fenced code block', () => {
    const spoken = sanitizeForSpeech('I fixed it:\n```ts\nconst x = 1;\nexport default x;\n```\nTests pass.');

    expect(spoken).not.toContain('const x');
    expect(spoken).not.toContain('export default');
    expect(spoken).toContain('Tests pass.');
  });

  it('never speaks a raw diff', () => {
    const spoken = sanitizeForSpeech('Updated login.\n@@ -1,4 +1,6 @@\n- old line\n+ new line\nDone.');

    expect(spoken).not.toContain('@@');
    expect(spoken).not.toContain('old line');
    expect(spoken).toContain('Done.');
  });

  it('never speaks a markdown table', () => {
    const spoken = sanitizeForSpeech('Results:\n| Name | Value |\n| --- | --- |\n| a | 1 |\nAll good.');

    expect(spoken).not.toContain('Name');
    expect(spoken).toContain('All good.');
  });

  it('never speaks inline code', () => {
    expect(sanitizeForSpeech('Call `useFoolVoiceSession()` to start.')).not.toContain('useFoolVoiceSession');
  });

  it('never speaks a long URL but keeps the link label', () => {
    const spoken = sanitizeForSpeech('See [the docs](https://example.com/a/very/long/path?x=1) for details.');

    expect(spoken).not.toContain('example.com');
    expect(spoken).toContain('the docs');
  });

  it('never speaks a commit hash', () => {
    expect(sanitizeForSpeech('Committed as d64d6ecfc9a1b2c3 today.')).not.toContain('d64d6ecfc9a1b2c3');
  });

  it('never speaks a file path', () => {
    const spoken = sanitizeForSpeech('Changed C:\\Fool-AionUI\\packages\\desktop\\src\\index.ts today.');

    expect(spoken).not.toContain('packages');
    expect(spoken).not.toContain('index.ts');
  });

  it('never speaks something shaped like a secret', () => {
    const spoken = sanitizeForSpeech('Using api_key: sk-abcdef1234567890 for the call.');

    expect(spoken).not.toContain('sk-abcdef1234567890');
    expect(spoken).not.toContain('api_key');
  });

  it('never speaks tool telemetry lines', () => {
    const spoken = sanitizeForSpeech('Running: bun test\nExit code: 0\nstdout: 42 passed\nThe suite is green.');

    expect(spoken).not.toContain('Exit code');
    expect(spoken).not.toContain('stdout');
    expect(spoken).toContain('The suite is green.');
  });

  it('strips markdown emphasis and headings but keeps the words', () => {
    const spoken = sanitizeForSpeech('## Summary\nI **fixed** the *login* bug.');

    expect(spoken).toBe('Summary I fixed the login bug.');
  });

  it('returns an empty string when only unspeakable content was present', () => {
    expect(sanitizeForSpeech('```\nconst a = 1;\n```')).toBe('');
  });

  it('leaves plain prose untouched', () => {
    const prose = 'I updated the login validation and the targeted tests pass.';

    expect(sanitizeForSpeech(prose)).toBe(prose);
  });
});

describe('truncateToSpokenLength', () => {
  it('leaves short text alone', () => {
    expect(truncateToSpokenLength('Short.', 100)).toBe('Short.');
  });

  it('cuts at a sentence boundary when one is available', () => {
    expect(truncateToSpokenLength('First one. Second one. Third one.', 24)).toBe('First one. Second one.');
  });

  it('cuts at a word boundary when no sentence fits', () => {
    expect(truncateToSpokenLength('supercalifragilistic expialidocious extra', 25)).toBe('supercalifragilistic…');
  });
});
