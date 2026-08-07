/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { configService } from '@/common/config/configService';
import {
  findLocalSkill,
  LOCAL_SKILLS_CONFIG_KEY,
  localSkillId,
  sanitizeLocalSkills,
  type LocalSkill,
  type LocalSkillAction,
} from '@/common/voice/localSkills';

/**
 * The skills the user taught, and doing one.
 *
 * Kept in `configService` beside the other voice settings rather than in a store
 * of its own: it is already the client's preferences, already cached so a first
 * read has an answer, and already tells other windows when something changes.
 *
 * Every read goes back through the sanitiser. Not defensiveness for its own sake
 * — the file can be edited by hand and is written by a model, and this is the
 * one record in the app that ends in something being opened.
 */

export const peekLocalSkills = (): LocalSkill[] => sanitizeLocalSkills(configService.get(LOCAL_SKILLS_CONFIG_KEY));

/** Teaches one, replacing an earlier skill of the same name. */
export const learnLocalSkill = async (skill: {
  name: string;
  when: string;
  action: LocalSkillAction;
}): Promise<LocalSkill | null> => {
  const kept = sanitizeLocalSkills([...peekLocalSkills(), skill]);
  const id = localSkillId(skill.name);
  const saved = kept.find((entry) => entry.id === id);
  // Nothing stored when the sanitiser refused it, so a skill that could not be
  // trusted to run never becomes one the user believes they have.
  if (!saved) return null;

  await configService.set(LOCAL_SKILLS_CONFIG_KEY, kept);
  return saved;
};

/** Drops one by name. */
export const forgetLocalSkill = async (name: string): Promise<boolean> => {
  const before = peekLocalSkills();
  const found = findLocalSkill(before, name);
  if (!found) return false;

  await configService.set(
    LOCAL_SKILLS_CONFIG_KEY,
    before.filter((skill) => skill.id !== found.id)
  );
  return true;
};

/**
 * Does one, here, without an agent.
 *
 * The whole point of the feature is this function being two lines long. Opening
 * an address and opening a path are things the app has always been able to do;
 * what was missing was a record saying which one the user meant by a phrase.
 */
export const runLocalSkill = async (skill: LocalSkill): Promise<void> => {
  if (skill.action.kind === 'open-url') {
    await ipcBridge.shell.openExternal.invoke(skill.action.url);
    return;
  }
  await ipcBridge.shell.openFile.invoke(skill.action.path);
};
