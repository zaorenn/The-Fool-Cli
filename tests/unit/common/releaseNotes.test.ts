/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { parseChangelog, selectReleaseNotes } from '@/common/update/releaseNotes';

const CHANGELOG = `# Changelog

The Fool is a fork of [AionUi](https://github.com/iOfficeAI/AionUi) (Apache-2.0). Release history
from before the fork lives in that project; this file records what has changed here.

## 2.3.4

### Features

- A first thing.
- A second thing that runs
  onto a second line.

### Fixes

- Something that used to be broken.

## 2.3.3

- An entry with no section heading at all.

## 2.3.2

### Fixes

- Older still.
`;

describe('parseChangelog', () => {
  it('reads one entry per version heading, newest first, and ignores the file preamble', () => {
    const entries = parseChangelog(CHANGELOG);

    expect(entries.map((entry) => entry.version)).toEqual(['2.3.4', '2.3.3', '2.3.2']);
    expect(JSON.stringify(entries)).not.toContain('fork of');
  });

  it('groups bullets under the heading above them', () => {
    const [latest] = parseChangelog(CHANGELOG);

    expect(latest.sections).toEqual([
      { title: 'Features', items: ['A first thing.', 'A second thing that runs onto a second line.'] },
      { title: 'Fixes', items: ['Something that used to be broken.'] },
    ]);
  });

  it('keeps bullets that have no section heading, under an unnamed section', () => {
    const entry = parseChangelog(CHANGELOG).find((candidate) => candidate.version === '2.3.3');

    expect(entry?.sections).toEqual([{ title: '', items: ['An entry with no section heading at all.'] }]);
  });

  it('returns nothing for text that is not a changelog', () => {
    expect(parseChangelog('')).toEqual([]);
    expect(parseChangelog('just some prose with no headings')).toEqual([]);
  });

  it('skips a version heading that is not a version', () => {
    expect(parseChangelog('## Unreleased\n\n- nothing yet\n')).toEqual([]);
  });
});

describe('selectReleaseNotes', () => {
  const entries = parseChangelog(CHANGELOG);

  it('returns every version between the one last seen and the one now running', () => {
    const selected = selectReleaseNotes(entries, { since: '2.3.2', upTo: '2.3.4' });

    expect(selected.map((entry) => entry.version)).toEqual(['2.3.4', '2.3.3']);
  });

  it('excludes the version last seen and anything newer than what is running', () => {
    const selected = selectReleaseNotes(entries, { since: '2.3.3', upTo: '2.3.3' });

    expect(selected).toEqual([]);
  });

  it('shows only the running version when nothing was seen before', () => {
    const selected = selectReleaseNotes(entries, { upTo: '2.3.4' });

    expect(selected.map((entry) => entry.version)).toEqual(['2.3.4']);
  });

  it('tolerates a version this changelog has never heard of', () => {
    const selected = selectReleaseNotes(entries, { since: '2.3.2', upTo: '9.9.9' });

    expect(selected.map((entry) => entry.version)).toEqual(['2.3.4', '2.3.3']);
  });

  it('refuses a version string that is not a version rather than guessing', () => {
    expect(selectReleaseNotes(entries, { since: 'nonsense', upTo: '2.3.4' }).map((e) => e.version)).toEqual(['2.3.4']);
    expect(selectReleaseNotes(entries, { upTo: 'nonsense' })).toEqual([]);
  });
});
