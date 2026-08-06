/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { runAgentTask } from '@renderer/services/voice/session/runAgentTask';
import { peekVoiceSettings } from '@renderer/services/voice/voiceSettingsStore';
import type { ToolHost } from './types';

/**
 * "Build me a web app, make it macOS style" — all the way to looking at it.
 *
 * Handing the request to the agent was already possible and was not enough. The
 * agent wrote files and stopped, and the user was left holding a folder path
 * they had been told about in a sentence: the thing they asked for existed and
 * they could not see it. Someone who asks for an app out loud wants to look at
 * an app, not to be told where one is.
 *
 * So this is the whole arc. A folder is chosen *here*, before the agent starts,
 * and named in the brief — which removes the one genuinely unreliable step,
 * working out afterwards where the files went. When the agent finishes, the
 * folder is served over loopback and opened in whatever browser the user
 * actually uses.
 */

/** How long a name may be before it stops being a folder name. */
const MAX_SLUG = 40;

/**
 * A folder name from what was asked for.
 *
 * Latin letters and digits only. The request may be in any language and any
 * script, and a path built out of one is a class of problem — a shell that
 * mangles it, a server that percent-encodes it, a filesystem that refuses it —
 * that has nothing to do with what the user wanted. When nothing survives, the
 * timestamp alone is a perfectly good name.
 */
export const workspaceSlug = (request: string, now: number = Date.now()): string => {
  const slug = request
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/, '');
  const stamp = new Date(now)
    .toISOString()
    .replaceAll(/[^0-9]/g, '')
    .slice(0, 14);
  return slug.length > 0 ? `${slug}-${stamp}` : `app-${stamp}`;
};

/**
 * What the agent is actually asked to do.
 *
 * Three things it would otherwise have to guess, stated instead. Where to put
 * it, because guessing is what made the result unfindable. That the entry point
 * is `index.html`, because that is what can be served without a build step and
 * therefore what can be looked at a second after it is written. And that it must
 * run from a plain file server, because half of what a model reaches for by
 * habit — a dev server, a bundler, an npm install — turns a thirty-second
 * request into a five-minute one and often into a failure.
 */
export const buildBrief = (request: string, directory: string): string =>
  [
    request,
    '',
    'How this one is delivered:',
    `- Build it in exactly this folder, creating it if it is not there: ${directory}`,
    '- The entry point must be `index.html` at the root of that folder.',
    '- It has to run from a plain static file server: no build step, no bundler, no npm install, no dev server. Plain HTML, CSS and JavaScript, with any libraries either written in or inlined.',
    '- Everything must load from the page itself or from an https URL. Nothing may depend on a file outside that folder.',
    '- Make it finished rather than a sketch: real content, real styling, and it should work when it is opened.',
    '- When it is done, say in one sentence what you built. Do not read the folder path out — the user will be looking at it.',
  ].join('\n');

export type BuildOutcome = { ok: true; url: string; summary: string } | { ok: false; error: string; summary?: string };

/**
 * Builds what was asked for and opens it.
 *
 * Never throws: a failure at any stage comes back as something the assistant can
 * say out loud, because from the user's side an exception here is the voice
 * going quiet after promising them an app.
 */
export const buildAndPreview = async (host: ToolHost, callId: string, request: string): Promise<BuildOutcome> => {
  const { t } = host;

  const root = await window.electronAPI?.previewWorkspaceRoot?.();
  if (!root) return { ok: false, error: t('settings.voice.conversationBuildUnavailable') };

  // Forward slashes: this string goes into a prompt, and a Windows path written
  // with backslashes comes back out of a model with half of them eaten as
  // escapes. Every tool the agent has takes either spelling.
  const directory = `${root.replaceAll('\\', '/')}/${workspaceSlug(request)}`;

  host.updateActivity(callId, {
    label: request,
    detail: t('settings.voice.conversationBuilding'),
    state: 'running',
  });
  // Before the wait, not after: this runs for minutes and the user has to be
  // able to keep talking through it.
  host.backToListening();

  const stopHeartbeat = host.startWorkingHeartbeat();
  let step = 0;
  const outcome = await runAgentTask({
    request: buildBrief(request, directory),
    settings: peekVoiceSettings(),
    onProgress: (detail) => {
      if (detail.length === 0) return;
      step += 1;
      host.updateActivity(`${callId}#${step}`, { label: detail, detail, state: 'completed' });
    },
  }).finally(stopHeartbeat);

  if (outcome.ok === false) {
    const error = t(`settings.voice.conversationTaskError.${outcome.reason}`, {
      defaultValue: outcome.detail ?? outcome.reason,
    });
    host.updateActivity(callId, { detail: error, state: 'failed' });
    return { ok: false, error };
  }

  const served = await window.electronAPI?.servePreview?.(directory);
  if (!served || served.ok === false) {
    // The agent said it finished and there is nothing to open. Reported as the
    // failure it is rather than as a success with no window: the user is about
    // to be told their app is ready.
    const error =
      served && served.ok === false && served.reason === 'no-entry'
        ? t('settings.voice.conversationBuildNoEntry')
        : t('settings.voice.conversationBuildUnavailable');
    host.updateActivity(callId, { detail: error, state: 'failed' });
    return { ok: false, error, summary: outcome.summary };
  }

  await ipcBridge.shell.openExternal.invoke(served.url);
  host.updateActivity(callId, {
    detail: t('settings.voice.conversationBuildOpened', { url: served.url }),
    state: 'completed',
  });
  return { ok: true, url: served.url, summary: outcome.summary };
};
