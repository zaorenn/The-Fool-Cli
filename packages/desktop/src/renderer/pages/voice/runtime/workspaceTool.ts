/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { appFolderName, WORKSPACE_APP_BRIDGE } from '@/common/config/workspaceApp';
import { findWorkspaceByName, normalizeWorkspaceName } from '@/common/config/workspaces';
import { captureWorkspace, enterWorkspace, peekWorkspaces, saveWorkspace } from '@renderer/hooks/config/useWorkspaces';
import { runAgentTask, type AgentTaskStep } from '@renderer/services/voice/session/runAgentTask';
import { peekVoiceMemory } from '@renderer/services/voice/session/voiceMemoryStore';
import { peekVoiceSettings } from '@renderer/services/voice/voiceSettingsStore';
import type { ToolHost } from './types';

/**
 * "Make me something that turns a link into guitar tab."
 *
 * This is the largest thing the voice can do, and the shape of it is three
 * parties again. The user says what they want. The agent builds it — a real
 * page, in a folder, written against a bridge it is told about. The app puts it
 * in a workspace, switches to it, and shows it.
 *
 * The brief below is most of the work. An agent asked to "build an app" writes a
 * static mock-up with fake data, every time, unless it is told two things: that
 * the page it is writing has an assistant behind it, and how to reach it. So the
 * bridge is described in the brief rather than left to be discovered, and the
 * instruction not to invent results is stated as an absolute — a guitar-tab app
 * that shows a plausible tab it made up is worse than one that says it could not
 * get the audio.
 */

/** How long a page may be, so one request cannot fill the disk. */
const MAX_APP_FILES = 24;

const briefFor = (name: string, wanted: string, folder: string): string =>
  [
    `Build a small web app called "${name}" and put it in ${folder.replaceAll('\\', '/')}.`,
    '',
    'What the user asked for, in their words:',
    '',
    wanted,
    '',
    '## What you are building',
    '',
    'A static page — `index.html`, plus any `.css` and `.js` beside it. No build step, no',
    'framework, no npm install, no server of its own. It is opened directly, so everything it',
    'needs must be in those files or reached through the bridge below.',
    '',
    '## It is not alone — it has an assistant behind it',
    '',
    'This is the part that makes it worth building. The page runs inside The Fool, and a global',
    '`fool` object is already there before your first line runs. You do not create it and you must',
    'not stub it out:',
    '',
    '```js',
    "await fool.ask('…')      // hand a job to the agent; returns what it wrote. Minutes, not seconds.",
    "await fool.open(url)     // open a page in the user's own browser",
    'await fool.say(text)     // say something out loud, in the voice they chose',
    'await fool.store(k, v)   // keep something small between runs',
    'await fool.recall(k)     // read it back',
    '```',
    '',
    '`fool.ask` is the whole back end. Fetching a page, reading a file, transcribing audio, calling',
    'a model, driving an application — describe the job in a sentence and it is done by the agent,',
    "with the user's own models and keys. Write the prompt as you would say it to a capable person.",
    '',
    '## What it must never do',
    '',
    '- **Never invent a result.** If the work has not come back, say so and show nothing. A page that',
    '  displays a plausible answer it made up is worse than one that reports a failure — the user',
    '  will act on it.',
    '- **Never fake the data while you build.** No sample results, no placeholder rows that look',
    '  real, no `setTimeout` pretending to work. Show a real empty state until real data arrives.',
    '- Show that something is happening. `fool.ask` takes minutes; a button that appears to do',
    '  nothing is a button people press four times.',
    '- Report failures where the user can see them, in a sentence, not in the console.',
    '',
    '## How it should look',
    '',
    'It sits inside The Fool, so let it inherit rather than compete: a transparent background,',
    "the system font stack, and `color-scheme: light dark` so it follows the user's theme. Keep it",
    'plain and legible. No frameworks and no downloaded fonts — nothing outside the folder loads.',
    '',
    `Write at most ${MAX_APP_FILES} files. When it is done, say in one sentence what it does and what to press first.`,
  ].join('\n');

/**
 * Builds a workspace around a page, and moves the user into it.
 *
 * Never throws: the caller is a conversation, and an unhandled rejection there
 * is the assistant going silent after somebody has just described the thing they
 * wanted built.
 */
export const runWorkspaceTool = async (
  host: ToolHost,
  callId: string,
  args: { action: string; name: string; wanted: string }
): Promise<Record<string, unknown>> => {
  const { t } = host;

  if (args.action === 'use') {
    const found = args.name.trim().length > 0 ? findWorkspaceByName(peekWorkspaces(), args.name) : null;
    if (!found) throw new Error(t('settings.voice.conversationWorkspaceUnknown', { name: args.name }));
    await enterWorkspace(found);
    const detail = t('settings.voice.conversationSettingWorkspace', { name: found.name });
    host.updateActivity(callId, { detail, state: 'completed' });
    host.backToListening();
    return { ok: true, detail, workspace: found.id };
  }

  const name = args.name.trim();
  const wanted = args.wanted.trim();
  if (name.length === 0 || wanted.length === 0) throw new Error(t('settings.voice.conversationWorkspaceIncomplete'));

  const folder = appFolderName(name);
  const root = await window.electronAPI?.prepareWorkspaceApp?.(folder);
  if (typeof root !== 'string' || root.length === 0) throw new Error('WORKSPACE_APP_UNAVAILABLE');

  host.updateActivity(callId, {
    label: name,
    detail: t('settings.voice.conversationWorkspaceBuilding'),
    state: 'running',
  });
  // Before the wait: this runs for minutes and the user has to be able to keep
  // talking through it — including to say what they meant more precisely.
  host.backToListening();

  const stopHeartbeat = host.startWorkingHeartbeat();
  let step = 0;
  const outcome = await runAgentTask({
    request: briefFor(name, wanted, root),
    settings: peekVoiceSettings(),
    memory: peekVoiceMemory(),
    onProgress: (event: AgentTaskStep) => {
      if (event.kind !== 'step' || event.text.length === 0) return;
      step += 1;
      host.updateActivity(`${callId}#${step}`, { label: event.text, detail: event.text, state: 'completed' });
    },
  }).finally(stopHeartbeat);

  if (outcome.ok === false) {
    const error = t(`settings.voice.conversationTaskError.${outcome.reason}`, {
      defaultValue: outcome.detail ?? outcome.reason,
    });
    host.updateActivity(callId, { detail: error, state: 'failed' });
    return { ok: false, error };
  }

  // The page has to be there before a workspace claims to have one: an agent
  // that reported success and wrote nothing would leave the user switched into
  // an empty panel with no way to tell what went wrong.
  const files = await window.electronAPI?.readWorkspaceApp?.(folder);
  if (!files || !Object.keys(files).some((file) => file.toLowerCase().endsWith('index.html'))) {
    const error = t('settings.voice.conversationWorkspaceNoPage');
    host.updateActivity(callId, { detail: error, state: 'failed' });
    return { ok: false, error };
  }

  const saved = await saveWorkspace({
    ...captureWorkspace(name, wanted),
    id: normalizeWorkspaceName(name),
    app: { folder, title: name, entry: 'index.html', requiresSkills: [] },
  });
  if (!saved) {
    const error = t('settings.voice.conversationWorkspaceIncomplete');
    host.updateActivity(callId, { detail: error, state: 'failed' });
    return { ok: false, error };
  }

  const detail = t('settings.voice.conversationWorkspaceBuilt', { name: saved.name });
  host.updateActivity(callId, { detail, state: 'completed' });
  return { ok: true, detail, workspace: saved.id, result: outcome.summary };
};

/** Re-exported so the brief and the page agree on what the bridge is called. */
export { WORKSPACE_APP_BRIDGE };
