/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  buildSkillBrief,
  buildSkillDraft,
  isDraftUsable,
  skillSlug,
  type SkillDraft,
  type SkillRecordingSummary,
} from '@/common/voice/skillDraft';
import { runAgentTask, type AgentTaskStep } from '@renderer/services/voice/session/runAgentTask';
import { peekVoiceMemory } from '@renderer/services/voice/session/voiceMemoryStore';
import { peekVoiceSettings } from '@renderer/services/voice/voiceSettingsStore';
import type { ToolHost } from './types';

/**
 * "Let me show you", and then it is a skill.
 *
 * The app could already be *told* a way of doing things — that is `app_learn`,
 * and what it produces is a note in `agent.md` that the spoken assistant
 * follows. This is the other half, and it is a different thing: a real skill in
 * the library, with a folder and a `SKILL.md`, available to every agent and to
 * conversations that were nowhere near the one where it was learned.
 *
 * Three parties, each doing the part it is actually able to do. The user
 * explains, and optionally demonstrates. The assistant holding the conversation
 * writes the first draft, because it is the one that heard the explanation. The
 * agent installs it, because it has hands, and it can open the screenshots and
 * name the windows and buttons in them — which is the difference between a
 * skill that works and a paraphrase of the obvious.
 */

/** What a demonstration produced, if there was one. */
let recording: SkillRecordingSummary | null = null;

/** Where a recording is being written, while one is running. */
let recordingFolder: string | null = null;

/** True while the screen is being watched, for anything that needs to know. */
export const isShowingSkill = (): boolean => recordingFolder !== null;

/** Drops any half-finished demonstration, for a conversation that has ended. */
export const forgetSkillRecording = (): void => {
  if (recordingFolder !== null) void window.electronAPI?.cancelSkillRecording?.();
  recordingFolder = null;
  recording = null;
};

const bridge = () => window.electronAPI;

/**
 * Starts watching the screen.
 *
 * Answers with the folder rather than a bare success so the assistant has
 * something concrete to say; the user is about to be recorded and deserves to be
 * told where it is going, not just that it started.
 */
const startShowing = async (name: string): Promise<string> => {
  const folder = await bridge()?.startSkillRecording?.(name || 'skill');
  if (typeof folder !== 'string' || folder.length === 0) throw new Error('SKILL_RECORD_UNAVAILABLE');
  recordingFolder = folder;
  recording = null;
  return folder;
};

/** Stops watching and keeps what was captured for the write that follows. */
const stopShowing = async (): Promise<SkillRecordingSummary | null> => {
  if (recordingFolder === null) return null;
  recordingFolder = null;

  const result = await bridge()?.stopSkillRecording?.();
  if (!result || result.frames.length === 0) return null;

  recording = { folder: result.folder, frames: result.frames, seconds: result.seconds };
  return recording;
};

/**
 * Writes the draft and hands it to the agent to finish and install.
 *
 * The draft is written from here rather than left to the agent because the words
 * in it are the user's: an agent given only a title writes a new skill from the
 * title and throws away the explanation, which is the one thing in this that
 * could not be reproduced.
 */
const installSkill = async (host: ToolHost, callId: string, draft: SkillDraft): Promise<Record<string, unknown>> => {
  const { t } = host;
  if (!isDraftUsable(draft)) throw new Error(t('settings.voice.conversationSkillIncomplete'));

  const shown = recording;
  const folder = shown?.folder ?? (await bridge()?.prepareSkillFolder?.(draft.name));
  if (typeof folder !== 'string' || folder.length === 0) throw new Error('SKILL_RECORD_UNAVAILABLE');

  const written = await bridge()?.writeSkillDraft?.(folder, buildSkillDraft(draft, shown ?? undefined));
  if (written !== true) throw new Error('SKILL_DRAFT_FAILED');

  host.updateActivity(callId, {
    label: draft.name,
    detail: t('settings.voice.conversationSkillWriting'),
    state: 'running',
  });
  // Back to listening before the wait: installing runs for a minute or two and
  // the user has to be able to keep talking through it.
  host.backToListening();

  const stopHeartbeat = host.startWorkingHeartbeat();
  let step = 0;
  const outcome = await runAgentTask({
    request: buildSkillBrief(draft, folder, shown ?? undefined),
    settings: peekVoiceSettings(),
    memory: peekVoiceMemory(),
    // Steps only. What the agent writes arrives a fragment at a time and would
    // put a row on screen per token.
    onProgress: (event: AgentTaskStep) => {
      if (event.kind !== 'step' || event.text.length === 0) return;
      step += 1;
      host.updateActivity(`${callId}#${step}`, { label: event.text, detail: event.text, state: 'completed' });
    },
  }).finally(stopHeartbeat);

  // Kept until the install is over, so a failure can be retried without asking
  // the user to demonstrate the whole thing again.
  if (outcome.ok === false) {
    const error = t(`settings.voice.conversationTaskError.${outcome.reason}`, {
      defaultValue: outcome.detail ?? outcome.reason,
    });
    host.updateActivity(callId, { detail: error, state: 'failed' });
    return { ok: false, error };
  }

  recording = null;
  const detail = t('settings.voice.conversationSkillInstalled', { name: draft.name });
  host.updateActivity(callId, { detail, state: 'completed' });
  // The slug goes back so the model can say what it is called in the library,
  // which is not always what the user called it out loud.
  return { ok: true, detail, skill: skillSlug(draft.name), result: outcome.summary };
};

/**
 * Runs one `app_skill` call.
 *
 * Never throws for a reason the model can act on — an unusable draft comes back
 * as a refusal it can ask about, because the alternative is a silent failure
 * after the user has just spent two minutes demonstrating something.
 */
export const runSkillTool = async (
  host: ToolHost,
  callId: string,
  args: { action: string; name: string; what: string; steps: string }
): Promise<Record<string, unknown>> => {
  const { t } = host;

  if (args.action === 'record') {
    const folder = await startShowing(args.name);
    const detail = t('settings.voice.conversationSkillRecording');
    host.updateActivity(callId, {
      label: args.name || t('settings.voice.conversationSkillUnnamed'),
      detail,
      state: 'running',
    });
    host.backToListening();
    return { ok: true, recording: true, detail, folder };
  }

  if (args.action === 'cancel') {
    forgetSkillRecording();
    const detail = t('settings.voice.conversationSkillCancelled');
    host.updateActivity(callId, { detail, state: 'completed' });
    host.backToListening();
    return { ok: true, detail };
  }

  // `stop` and `write` are the same request with and without a demonstration
  // behind it, so they go down one path: stop whatever is running, then write.
  const shown = await stopShowing();
  const result = await installSkill(host, callId, { name: args.name, what: args.what, steps: args.steps });
  return shown ? { ...result, frames: shown.frames.length } : result;
};
