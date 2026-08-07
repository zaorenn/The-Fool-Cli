/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { Workspace } from '@/common/config/workspaces';
import { runAgentTask } from '@renderer/services/voice/session/runAgentTask';
import { peekVoiceMemory } from '@renderer/services/voice/session/voiceMemoryStore';
import { peekVoiceSettings } from '@renderer/services/voice/voiceSettingsStore';

/**
 * What an imported workspace is missing, and getting it.
 *
 * A workspace carries its own page inside the file, so nothing about the app
 * itself can arrive incomplete. What can is everything it *depends on* — the
 * skills its page expects to be able to call. Those live in the user's library
 * rather than in the workspace, which is right: a skill is a thing you install
 * once and use everywhere, not something four workspaces should each carry a
 * copy of.
 *
 * So an import is two steps, and this is the second. Without it a received
 * workspace opens, looks correct, and fails the first time somebody presses the
 * button — which is the worst of the three possible outcomes, because it looks
 * like the app being broken rather than like something not being finished yet.
 */

/** Which of the skills a workspace expects are not in the library. */
export const missingSkills = async (workspace: Workspace): Promise<string[]> => {
  const wanted = workspace.app?.requiresSkills ?? [];
  if (wanted.length === 0) return [];

  // An unreadable library reads as "nothing installed", which is the safe way
  // round: it offers to fetch something already there rather than skipping
  // something that is not.
  const installed = await ipcBridge.fs.listAvailableSkills.invoke().catch((): { name: string }[] => []);
  const have = new Set((installed ?? []).map((skill) => skill.name.trim().toLowerCase()));

  return wanted.filter((skill) => !have.has(skill.trim().toLowerCase()));
};

export type SkillFetch = { ok: true; installed: string[] } | { ok: false; error: string };

/**
 * Asks the agent to find and install what is missing.
 *
 * The agent rather than a download, because there is no registry to download
 * from and inventing one would be inventing a supply chain. What there is: an
 * agent that holds the `fool-config` skill, can search, can read a repository,
 * and can call `config skills import` — which is exactly how the user would get
 * a skill themselves, done for them.
 *
 * Told to install only what was named. A workspace listing one skill must not
 * become an agent installing four things it thought looked useful.
 */
export const fetchMissingSkills = async (workspace: Workspace, missing: readonly string[]): Promise<SkillFetch> => {
  if (missing.length === 0) return { ok: true, installed: [] };

  const brief = [
    `A workspace called "${workspace.name}" has just been imported, and its page expects skills that are not`,
    'installed on this machine:',
    '',
    ...missing.map((skill) => `- ${skill}`),
    '',
    'Install exactly those and nothing else. For each one: look for it among the skills already available,',
    'then in the user’s external skill paths, then on the web if it is a known published skill. When you',
    'have a folder for it, install it with:',
    '',
    '```bash',
    `"$FOOL_HELPER_BIN" config skills import <<'JSON'`,
    '{ "skill_path": "/absolute/path/to/skill" }',
    'JSON',
    '```',
    '',
    'Do not invent a skill to satisfy the name. If you cannot find one, say which ones you could not find',
    'and stop — a made-up skill that silently does the wrong thing is worse than a missing one the user',
    'can go and get.',
    '',
    'Report in one sentence: which were installed, and which were not.',
  ].join('\n');

  const outcome = await runAgentTask({
    request: brief,
    settings: peekVoiceSettings(),
    memory: peekVoiceMemory(),
  });

  if (outcome.ok === false) return { ok: false, error: outcome.detail ?? outcome.reason };

  // Checked rather than believed: the agent reports what it did, and what
  // matters is what is actually in the library now.
  const stillMissing = await missingSkills(workspace);
  return { ok: true, installed: missing.filter((skill) => !stillMissing.includes(skill)) };
};
