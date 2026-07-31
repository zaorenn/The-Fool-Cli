/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Apache-2.0 §4 requires this fork to carry upstream's attribution. It does not
 * ask the fork to sign upstream's name to work upstream never wrote — and that
 * is what had happened: 112 files added by this project's own feature commits
 * (Fool Voice, themes, the LM Studio picker) opened with
 * `Copyright 2026 AionUi (aionui.com)`, because the header was copied along with
 * the file template.
 *
 * The direction matters. Losing upstream's notice on a derived file is a licence
 * violation; adding it to a new file misassigns this project's work. These guard
 * both.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../..');

/**
 * `--untracked` matters here: the file this is meant to catch is a brand new
 * one, and without the flag `git grep` skips it until it is staged — so the
 * mistake would sail past the author and only surface later.
 */
const sources = (pattern: string, untracked = true): string[] => {
  // This file spells both headers out, in the patterns and in the prose above,
  // so it matches everything it searches for and would flag itself.
  const args = [
    'grep',
    '-l',
    ...(untracked ? ['--untracked'] : []),
    pattern,
    '--',
    '.',
    ':!tests/unit/upstreamAttribution.test.ts',
  ];
  let out: string;
  try {
    out = execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1 << 26 });
  } catch (error) {
    // git grep exits 1 when nothing matched, which is not a failure here.
    const status = (error as { status?: number }).status;
    if (status === 1) return [];
    throw error;
  }
  return out
    .split('\n')
    .filter(Boolean)
    .map((path) => path.replace(/\\/g, '/'));
};

/**
 * Files upstream authored during 2026, verified one by one against the commit
 * that added them. Shrinking this list is fine — a file may be deleted or
 * rewritten. Growing it means a new file claimed upstream's copyright, which is
 * what this exists to catch.
 */
const UPSTREAM_AUTHORED_IN_2026 = [
  'packages/desktop/src/common/platform/bridge.ts',
  'packages/desktop/src/common/platform/storage.ts',
  'packages/desktop/src/process/services/installerLastFailure.ts',
  'packages/desktop/src/renderer/components/settings/UpdateModal.tsx',
  'packages/desktop/src/renderer/components/settings/UpdateNotificationCard.tsx',
  'packages/desktop/src/renderer/components/settings/checkForUpdatesShared.ts',
  'packages/desktop/src/renderer/components/settings/updateNotificationState.ts',
  'packages/desktop/src/renderer/components/settings/updateReadyState.ts',
  'packages/desktop/src/renderer/components/settings/useUpdateNotificationController.ts',
  'packages/desktop/src/renderer/hooks/assistant/useAssistantOrder.ts',
  'packages/desktop/src/renderer/pages/conversation/utils/newConversationName.ts',
  'packages/desktop/src/renderer/pages/settings/AssistantSettings/home/EnabledAssistantsList.tsx',
  'tests/unit/common-config/modelCapabilities.dom.test.tsx',
  'tests/unit/common-platform/bridge.test.ts',
  'tests/unit/common-platform/storage.test.ts',
  'tests/unit/settings/AboutModalContent.dom.test.tsx',
  'tests/unit/settings/updateNotificationState.test.ts',
];

describe('upstream attribution', () => {
  it('signs no new file with upstream copyright', () => {
    const claiming = sources('Copyright 2026 AionUi (aionui.com)');
    const known = new Set(UPSTREAM_AUTHORED_IN_2026);

    // A new file gets `Copyright 2026 The Fool contributors`. A file derived from
    // upstream keeps their line and adds ours beneath it — see `updateFeed.ts`.
    expect(claiming.filter((path) => !known.has(path))).toEqual([]);
  });

  it('still carries upstream copyright on the work upstream wrote', () => {
    // The opposite failure: a rebrand pass that strips the notice off derived
    // files would leave this project distributing upstream's code uncredited.
    expect(sources('Copyright 2025 AionUi (aionui.com)', false).length).toBeGreaterThan(500);
  });

  it('keeps the fork notice and the upstream projects it names', () => {
    const notice = execFileSync('git', ['show', 'HEAD:NOTICE'], { cwd: repoRoot, encoding: 'utf8' });

    for (const required of ['AionUi', 'AionCore', 'aionrs', 'The Fool contributors']) {
      expect(notice).toContain(required);
    }
  });
});
