/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { configService } from '@/common/config/configService';
import {
  isValidHexColor,
  MAX_THEME_PALETTES,
  normalizePaletteName,
  sanitizeThemeOverrides,
  sanitizeThemePalettes,
  THEME_OVERRIDES_CONFIG_KEY,
  THEME_PALETTES_CONFIG_KEY,
  type ThemeColorKey,
  type ThemeOverrides,
} from '@/common/config/themeOverrides';
import { parseOpenUrls } from '@/common/realtime/openUrls';
import { buildSiteSearch } from '@/common/realtime/siteSearch';
import { runAgentTask, type AgentTaskStep } from '@renderer/services/voice/session/runAgentTask';
import {
  peekVoiceMemory,
  forgetVoiceFact,
  forgetVoiceLesson,
  forgetVoiceSkill,
  learnVoiceLesson,
  learnVoiceSkill,
  rememberVoiceAddress,
  rememberVoiceFact,
  rememberVoiceMeaning,
} from '@renderer/services/voice/session/voiceMemoryStore';
import { describeScreen } from '@renderer/services/voice/screenSight';
import { peekVoiceSettings } from '@renderer/services/voice/voiceSettingsStore';
import { applyThemeOverrides } from '@renderer/utils/theme/applyThemeOverrides';
import { normalizeEndpoint } from '../localPipeline';
import { buildAndPreview } from './buildTool';
import { applySpokenSetting } from './settingsTool';
import type { ToolHost, ToolInvocation } from './types';

/**
 * What the voice may actually do to the app and the computer.
 *
 * Split out of the runtime because the two answer different questions: the
 * runtime is about audio and turns, and this is about the app. They meet at
 * {@link ToolHost}, which is the small set of things a handler is allowed to do
 * to a conversation in progress — say it is working, take the floor back, stop
 * talking.
 */

/**
 * What the spoken word for a colour's job maps to in the theme.
 *
 * "Accent" rather than "primary" in the tool, because that is what a person
 * calls it — the stored key keeps the name the rest of the app uses.
 */
const THEME_TARGETS: Record<string, ThemeColorKey> = {
  accent: 'primary',
  background: 'background',
  surface: 'surface',
  text: 'text',
};

/**
 * Changes, keeps or recalls the app's colours, as asked out loud.
 *
 * The colour itself comes from the model rather than from a table here.
 * "Warmer", "like the sea", "the green of an old terminal" are language
 * problems, and a fixed list of five tones answered all of them with the same
 * five colours — the setting existed, the request did not survive it.
 *
 * Everything written is validated before it reaches a CSS variable: a hex value
 * from a model is untrusted input like any other.
 */
export const applyThemeAction = async (
  t: ToolHost['t'],
  action: string,
  target: string,
  color: string,
  name: string
): Promise<string> => {
  const stored = sanitizeThemeOverrides(configService.get(THEME_OVERRIDES_CONFIG_KEY));
  const palettes = sanitizeThemePalettes(configService.get(THEME_PALETTES_CONFIG_KEY));
  const key = THEME_TARGETS[target] ?? 'primary';

  const commit = async (colors: ThemeOverrides['colors']): Promise<void> => {
    const next = { colors };
    applyThemeOverrides(next);
    await configService.set(THEME_OVERRIDES_CONFIG_KEY, next);
  };

  if (action === 'reset') {
    await commit({});
    return t('settings.voice.conversationThemeReset');
  }

  if (action === 'set') {
    const hex = color.trim().toLowerCase();
    if (!isValidHexColor(hex)) throw new Error(t('settings.voice.conversationThemeBadColor'));
    await commit({ ...stored.colors, [key]: hex });
    return t('settings.voice.conversationThemeSet', { target: t(`settings.voice.conversationThemeTarget.${key}`) });
  }

  const label = normalizePaletteName(name);
  if (label.length === 0) throw new Error(t('settings.voice.conversationThemeNoName'));

  if (action === 'save') {
    // Oldest first, so a library kept out loud never grows without bound.
    const kept = Object.entries(palettes).slice(-(MAX_THEME_PALETTES - 1));
    const next = Object.fromEntries([...kept, [label, stored.colors]]);
    await configService.set(THEME_PALETTES_CONFIG_KEY, next);
    return t('settings.voice.conversationThemeSaved', { name: label });
  }

  if (action === 'use') {
    const found = palettes[label];
    if (!found) throw new Error(t('settings.voice.conversationThemeUnknownName', { name: label }));
    await commit(found);
    return t('settings.voice.conversationThemeUsed', { name: label });
  }

  throw new Error(t('settings.voice.conversationActionUnsupported'));
};

/**
 * Looks at the screen and hands back what is there, in words.
 *
 * The model doing the looking is a separate setting from the one holding the
 * conversation, defaulting to it: the fast conversational model is often
 * text-only, and a picture sent to one is refused rather than ignored.
 */
export const lookAtScreen = async (question: string): Promise<string> => {
  const realtime = peekVoiceSettings().realtime;
  return describeScreen({
    question,
    endpoint: normalizeEndpoint(realtime.localEndpoint),
    model: realtime.visionModel.trim() || realtime.model.trim(),
    language: realtime.language,
    // The whole display, not `session.screenshotSource`. That setting governs
    // the screenshot quietly attached to *every* spoken turn, and defaults to
    // this window for the obvious reason. This is the other case: the user has
    // just said "look at my screen", and answering with a photograph of the app
    // they are talking to is answering a question nobody asked.
    source: 'screen',
  });
};

/**
 * Turns the agent's running commentary into a list rather than one line.
 *
 * A delegated task reports a step at a time — opened the browser, typed the
 * search, clicked the third result — and all of it used to be written over the
 * same row, so the notch showed the latest step and no history. Watching an
 * agent work is the point of that surface: the user cannot see the desktop it is
 * driving, and one line of it is indistinguishable from a stuck task.
 *
 * Each step is its own entry, and the one before it is marked done as the next
 * arrives. Repeats are dropped: agents restate the same line while a tool runs,
 * and a list of eight identical rows is worse than one.
 *
 * What the agent is *writing* is not a step, and this is where that used to go
 * wrong. The answer arrives a few characters at a time, every fragment differing
 * from the last, so a hundred rows appeared holding a hundred prefixes of the
 * same sentence — the panel spelling out the reply letter by letter instead of
 * saying what was being done. It now has one row of its own, rewritten in place,
 * and it says the last thing written rather than all of it.
 */
const trackSteps = (host: ToolHost, callId: string): { note: (step: AgentTaskStep) => void; finish: () => void } => {
  let step = 0;
  let previous = '';
  let writing = false;

  const writingId = `${callId}#writing`;

  /** The tail of what has been written — a row, not a transcript. */
  const tail = (text: string): string => {
    const sentences = text.split(/(?<=[.!?])\s+/).filter((part) => part.trim().length > 0);
    return (sentences.at(-1) ?? text).trim().slice(0, 160);
  };

  return {
    note: (event: AgentTaskStep): void => {
      const line = event.text.trim();
      if (line.length === 0) return;

      if (event.kind === 'writing') {
        writing = true;
        host.updateActivity(writingId, {
          label: host.t('settings.voice.conversationTaskWriting'),
          detail: tail(line),
          state: 'running',
        });
        return;
      }

      if (line === previous) return;
      if (step > 0) host.updateActivity(`${callId}#${step}`, { state: 'completed' });
      step += 1;
      previous = line;
      host.updateActivity(`${callId}#${step}`, { label: line, detail: line, state: 'running' });
    },
    finish: (): void => {
      if (step > 0) host.updateActivity(`${callId}#${step}`, { state: 'completed' });
      if (writing) host.updateActivity(writingId, { state: 'completed' });
    },
  };
};

/**
 * Runs one tool the model called, and answers with the result.
 *
 * Returns the result rather than sending it, because the two transports deliver
 * it differently — a socket session posts it back over the socket, the local
 * pipeline puts it in the next request's messages — and the work of actually
 * doing the thing is identical either way.
 *
 * Never throws: every failure comes back as a result the model can talk about,
 * because an exception here would end the turn silently, which from the user's
 * side is the assistant ignoring them.
 */
export const runVoiceTool = async (host: ToolHost, invocation: ToolInvocation): Promise<Record<string, unknown>> => {
  const { t } = host;

  try {
    const args = JSON.parse(invocation.argumentsJson || '{}') as Record<string, unknown>;
    const text = (key: string): string => (typeof args[key] === 'string' ? (args[key] as string) : '');

    if (invocation.name === 'app_theme') {
      const detail = await applyThemeAction(t, text('action'), text('target') || 'accent', text('color'), text('name'));
      host.updateActivity(invocation.callId, { detail, state: 'completed' });
      host.backToListening();
      return { ok: true, detail };
    }

    if (invocation.name === 'app_look_at_screen') {
      host.updateActivity(invocation.callId, { detail: t('settings.voice.conversationLooking'), state: 'running' });
      const description = await lookAtScreen(text('question'));
      host.updateActivity(invocation.callId, { detail: description.slice(0, 160), state: 'completed' });
      host.backToListening();
      // Handed back as the screen's own words rather than a summary of them: the
      // model is about to say this out loud in its own voice, and summarising it
      // here would be a second, worse rewrite.
      return { ok: true, screen: description };
    }

    if (invocation.name === 'app_open_url') {
      // `urls` is the schema; `url` is what a small local model sends anyway.
      // Both are read, and only web addresses survive — see `parseOpenUrls`.
      const urls = parseOpenUrls(args.urls ?? args.url);
      if (urls.length === 0) throw new Error(t('settings.voice.conversationActionUnsupported'));

      // In order and one at a time. "Open each of those in turn" is a sequence
      // the user asked for, and the browser stacks tabs in the order it is
      // handed them.
      for (const url of urls) await ipcBridge.shell.openExternal.invoke(url);

      host.updateActivity(invocation.callId, {
        detail:
          urls.length === 1
            ? t('settings.voice.conversationOpened', { url: urls[0] })
            : t('settings.voice.conversationOpenedMany', { count: urls.length }),
        state: 'completed',
      });
      host.backToListening();
      // The count goes back so the model can say how many opened rather than
      // guessing, and notice when its list was longer than what was allowed.
      return { ok: true, opened: urls.length };
    }

    if (invocation.name === 'app_search') {
      // The whole of "open YouTube and find that song", in one navigation. It
      // used to be the agent's job — open a browser, find the box, type — which
      // is three minutes of clicking for something that is an address.
      const search = buildSiteSearch(text('site'), text('query'));
      if (!search) throw new Error(t('settings.voice.conversationActionUnsupported'));

      await ipcBridge.shell.openExternal.invoke(search.url);
      const detail = t('settings.voice.conversationSearched', { site: search.label, query: text('query').trim() });
      host.updateActivity(invocation.callId, { detail, state: 'completed' });
      host.backToListening();
      // The site goes back so the model can say where it looked rather than
      // guessing, and notice when the site it named was not one we know.
      return { ok: true, site: search.site, searched: true };
    }

    if (invocation.name === 'app_ask_jester') {
      const request = text('request').trim();
      if (request.length === 0) throw new Error(t('settings.voice.conversationActionUnsupported'));
      host.updateActivity(invocation.callId, {
        label: request,
        detail: t('settings.voice.conversationDelegated'),
        state: 'running',
      });
      // Back to listening *before* awaiting: the task runs for minutes and the
      // user has to be able to keep talking while it does. This is the whole
      // reason it is not the old navigate-and-prefill.
      host.backToListening();
      // Something to hear while it works. Minutes of silence from a voice that
      // was talking a moment ago reads as a crash — the user asks again, and now
      // the same job is running twice.
      const stopHeartbeat = host.startWorkingHeartbeat();
      const steps = trackSteps(host, invocation.callId);
      const outcome = await runAgentTask({
        request,
        settings: peekVoiceSettings(),
        memory: peekVoiceMemory(),
        onProgress: steps.note,
      }).finally(stopHeartbeat);
      steps.finish();
      if (outcome.ok === false) {
        const detail = t(`settings.voice.conversationTaskError.${outcome.reason}`, {
          defaultValue: outcome.detail ?? outcome.reason,
        });
        // Written down without being asked, for the two failures that say
        // something about the request rather than about the moment. A dropped
        // connection is not a lesson; a task this machine cannot carry out is
        // one, and finding that out twice is how the user loses faith in it.
        // The others are left alone on purpose — a memory that records every
        // hiccup is a memory nobody can read.
        if (outcome.reason === 'run-failed' || outcome.reason === 'agent-unavailable') {
          void learnVoiceLesson(`Asked to "${request}", the agent could not finish it: ${detail}`);
        }
        host.updateActivity(invocation.callId, { detail, state: 'failed' });
        return { ok: false, error: detail };
      }
      host.updateActivity(invocation.callId, {
        detail: outcome.summary.slice(0, 160) || t('settings.voice.conversationTaskDone'),
        state: 'completed',
      });
      return { ok: true, result: outcome.summary };
    }

    if (invocation.name === 'app_build_app') {
      const request = text('request').trim();
      if (request.length === 0) throw new Error(t('settings.voice.conversationActionUnsupported'));
      const built = await buildAndPreview(host, invocation.callId, request);
      if (built.ok === false) return { ok: false, error: built.error };
      // The address goes back so the model knows it really opened, and is told
      // not to read it out: nobody wants a port number spoken digit by digit.
      return { ok: true, opened: true, url: built.url, result: built.summary };
    }

    if (invocation.name === 'app_settings') {
      const detail = await applySpokenSetting(text('setting'), text('value'), t);
      host.updateActivity(invocation.callId, { detail, state: 'completed' });
      host.backToListening();
      return { ok: true, detail };
    }

    if (invocation.name === 'app_remember') {
      const fact = text('fact').trim();
      const callMe = text('callMe').trim();
      const word = text('word').trim();
      const means = text('means').trim();
      const meaning = word.length > 0 && means.length > 0;
      if (fact.length === 0 && callMe.length === 0 && !meaning) {
        throw new Error(t('settings.voice.conversationActionUnsupported'));
      }

      // The name first, so that if only one of the several survives a failure it
      // is the one the very next sentence needs.
      if (callMe.length > 0) await rememberVoiceAddress(callMe);
      if (meaning) await rememberVoiceMeaning(word, means);
      if (fact.length > 0) await rememberVoiceFact(fact);

      const detail =
        callMe.length > 0
          ? t('settings.voice.conversationRememberedName', { name: callMe })
          : meaning
            ? t('settings.voice.conversationRememberedMeaning', { word })
            : t('settings.voice.conversationRemembered');
      host.updateActivity(invocation.callId, { detail, state: 'completed' });
      host.backToListening();
      // The name goes back as well as the acknowledgement: a model that has just
      // been told what to call someone should use it in its next sentence, and
      // handing it back is cheaper than hoping it kept it.
      return { ok: true, detail, ...(callMe.length > 0 ? { callMe } : {}) };
    }

    if (invocation.name === 'app_learn') {
      const lesson = text('lesson').trim();
      const name = text('skillName').trim();
      const steps = text('skillSteps').trim();
      const teaching = name.length > 0 && steps.length > 0;
      if (lesson.length === 0 && !teaching) throw new Error(t('settings.voice.conversationActionUnsupported'));

      if (teaching) await learnVoiceSkill({ name, when: text('skillWhen').trim(), steps });
      if (lesson.length > 0) await learnVoiceLesson(lesson);

      const detail = teaching
        ? t('settings.voice.conversationLearnedSkill', { name })
        : t('settings.voice.conversationLearned');
      host.updateActivity(invocation.callId, { detail, state: 'completed' });
      host.backToListening();
      return { ok: true, detail };
    }

    if (invocation.name === 'app_forget') {
      const about = text('about').trim();
      if (about.length === 0) throw new Error(t('settings.voice.conversationActionUnsupported'));

      const scope = text('scope').trim();
      // A skill is a named block and a lesson is a line, so they come out of the
      // document differently. Anything else is something known about the person,
      // which is what "forget that" nearly always means.
      if (scope === 'skill') await forgetVoiceSkill(about);
      else if (scope === 'lesson') await forgetVoiceLesson(about);
      else await forgetVoiceFact(about);

      const detail = t('settings.voice.conversationForgot', { about });
      host.updateActivity(invocation.callId, { detail, state: 'completed' });
      host.backToListening();
      return { ok: true, detail };
    }

    if (invocation.name === 'app_standby') {
      // Whatever it was part-way through saying is abandoned: being asked to
      // wait means stop now, not stop at the end of this sentence.
      host.flushOutput();
      host.setStandby(true);
      host.updateActivity(invocation.callId, { detail: t('settings.voice.conversationStandbyOn'), state: 'completed' });
      return { ok: true };
    }

    if (invocation.name === 'app_resume') {
      host.setStandby(false);
      host.updateActivity(invocation.callId, {
        detail: t('settings.voice.conversationStandbyOff'),
        state: 'completed',
      });
      host.backToListening();
      return { ok: true };
    }

    throw new Error(t('settings.voice.conversationActionUnsupported'));
  } catch (toolError) {
    const message = toolError instanceof Error ? toolError.message : String(toolError);
    const detail = t(`settings.voice.conversationError.${message}`, { defaultValue: message });
    host.updateActivity(invocation.callId, { detail, state: 'failed' });
    host.backToListening();
    return { ok: false, error: detail };
  }
};
