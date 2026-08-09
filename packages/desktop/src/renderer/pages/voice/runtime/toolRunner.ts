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
import { findLocalSkill } from '@/common/voice/localSkills';
import {
  forgetLocalSkill,
  learnLocalSkill,
  peekLocalSkills,
  runLocalSkill,
} from '@renderer/services/voice/session/localSkillStore';
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
  forgetVoiceRule,
  rememberVoiceRule,
} from '@renderer/services/voice/session/voiceMemoryStore';
import { describeScreen, takeScreenLook } from '@renderer/services/voice/screenSight';
import { peekVoiceSettings } from '@renderer/services/voice/voiceSettingsStore';
import { applySurfaceIntent, readSurfaceIntent, type SurfaceIntent } from '@/common/theme/surfaceIntent';
import { defaultSurfaceChoice, type SurfaceStyleChoice } from '@/common/theme/surfaceChoice';
import { peekSurfaceChoice, SURFACE_STYLE_CONFIG_KEY } from '@renderer/hooks/config/useSurfaceStyle';
import { applyThemeOverrides } from '@renderer/utils/theme/applyThemeOverrides';
import { normalizeEndpoint } from '../localPipeline';
import { buildAndPreview } from './buildTool';
import { applySpokenSetting } from './settingsTool';
import { runSkillTool } from './skillTool';
import { runWorkspaceTool } from './workspaceTool';
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
/**
 * Writes a material choice the way the panel does.
 *
 * Through `configService` rather than onto the document, so the change reaches
 * every window and survives a restart — the same path the settings panel takes.
 * The hook applies it to the page when the store tells it to.
 */
const writeSurfaceChoice = async (choice: SurfaceStyleChoice): Promise<void> => {
  await configService.set(SURFACE_STYLE_CONFIG_KEY, choice);
};

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
  name: string,
  intent: SurfaceIntent = {}
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
    await writeSurfaceChoice(defaultSurfaceChoice());
    return t('settings.voice.conversationThemeReset');
  }

  // What the app is made of, and how it moves. Both go through the same pure
  // reader as every other caller, so a sentence said out loud and a sentence
  // typed change the same thing by the same amount.
  if (action === 'style' || action === 'dial') {
    const { choice, changed } = applySurfaceIntent(peekSurfaceChoice(), intent);
    // Saying it changed when it did not is the one failure this application is
    // built against, so an intent that moved nothing says so.
    if (changed.length === 0) return t('settings.voice.conversationThemeUnchanged');
    await writeSurfaceChoice(choice);
    return t('settings.voice.conversationThemeMaterial', {
      name: t(`settings.appearance.material.${choice.style}`),
    });
  }

  if (action === 'set') {
    const hex = color.trim().toLowerCase();
    if (!isValidHexColor(hex)) throw new Error(t('settings.voice.conversationThemeBadColor'));
    await commit({ ...stored.colors, [key]: hex });
    // The accent is also the one colour the material derives everything from,
    // so setting it here and not there would leave the application half
    // changed — the buttons the new colour and the surfaces the old one.
    if (key === 'primary') await writeSurfaceChoice({ ...peekSurfaceChoice(), accent: hex });
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
  // Started the moment the user's words pointed at a screen, which is a whole
  // model round trip before this call exists. Usually already answered.
  const alreadyLooking = takeScreenLook();
  if (alreadyLooking) {
    try {
      return await alreadyLooking;
    } catch {
      // It failed for a reason this call is about to run into as well — but it
      // may also have been a capture that lost a race with a screen lock, and
      // one more attempt costs a second rather than an answer.
    }
  }

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
 * What the agent is *writing* is not a step, and this is where it went wrong
 * twice. The answer arrives a few characters at a time, and reported as steps it
 * opened a row per fragment: a hundred rows holding a hundred prefixes of one
 * sentence, on the page and on the notch, which is the panel spelling the reply
 * out letter by letter instead of saying what was being done.
 *
 * Giving it a single row rewritten in place fixed the flood and not the reason
 * it looked wrong: the row's text still changed on every token, so both surfaces
 * still showed running letters. Nobody reads a line that is being retyped thirty
 * times a second — what they read is that something is happening, which one
 * stable row already says.
 *
 * So the row is written when a *sentence* is finished, and not otherwise. A
 * paragraph of answer moves it three or four times, which is a progress report;
 * everything in between is the same row, unchanged.
 */
const trackSteps = (host: ToolHost, callId: string): { note: (step: AgentTaskStep) => void; finish: () => void } => {
  let step = 0;
  let previous = '';
  let writing = false;
  /** How many finished sentences have already been reported. */
  let reported = 0;

  const writingId = `${callId}#writing`;

  /** The finished sentences in what has been written so far. */
  const sentences = (text: string): string[] =>
    text
      .split(/(?<=[.!?…])\s+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0 && /[.!?…]$/.test(part));

  return {
    note: (event: AgentTaskStep): void => {
      const line = event.text.trim();
      if (line.length === 0) return;

      if (event.kind === 'writing') {
        const finished = sentences(line);
        // The first fragment puts the row up — the user needs to know it is
        // writing — and after that only a completed sentence moves it.
        if (writing && finished.length <= reported) return;

        writing = true;
        reported = finished.length;
        host.updateActivity(writingId, {
          label: host.t('settings.voice.conversationTaskWriting'),
          detail: finished.at(-1)?.slice(0, 160) ?? '',
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
    // Models send booleans as booleans and as the words for them, about equally
    // often. Both are the same intent and refusing one would refuse the request.
    const flag = (key: string): boolean =>
      args[key] === true || (typeof args[key] === 'string' && /^(true|yes)$/i.test(args[key] as string));

    if (invocation.name === 'app_theme') {
      const detail = await applyThemeAction(
        t,
        text('action'),
        text('target') || 'accent',
        text('color'),
        text('name'),
        readSurfaceIntent(args)
      );
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
      // Back to listening *before* the work starts: the task runs for minutes
      // and the user has to be able to keep talking while it does. This is the
      // whole reason it is not the old navigate-and-prefill.
      host.backToListening();
      const steps = trackSteps(host, invocation.callId);
      // Not awaited. Awaiting it held the turn open for the length of the task,
      // so the conversation could not go anywhere else and a second request had
      // to wait for the first — which is not delegating, it is queueing. The
      // finish arrives later, as something the assistant volunteers.
      const finished = runAgentTask({
        request,
        settings: peekVoiceSettings(),
        memory: peekVoiceMemory(),
        onProgress: steps.note,
      }).then((outcome) => {
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
          return { ok: false, detail };
        }
        host.updateActivity(invocation.callId, {
          detail: outcome.summary.slice(0, 160) || t('settings.voice.conversationTaskDone'),
          state: 'completed',
        });
        return { ok: true, detail: outcome.summary };
      });
      host.announceLater(request, finished);

      // What goes back to the model is that the work *started*, and nothing
      // about how it went — because nothing is known yet, and a tool result
      // that reads like an outcome is how a model comes to say a thing is done
      // while it is still running.
      return { ok: true, accepted: true, result: t('settings.voice.conversationTaskAccepted') };
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

    if (invocation.name === 'app_skill_teach') {
      const name = text('name').trim();
      const when = text('when').trim();
      const url = text('url').trim();
      const path = text('path').trim();
      if (name.length === 0 || when.length === 0) {
        throw new Error(t('settings.voice.conversationActionUnsupported'));
      }
      // The schema does not demand a target, because the model usually has the
      // name and the trigger a turn before it has an address. Answering that
      // case with the generic "not something the voice can do" taught it the
      // tool itself was broken and it gave up — so this names the missing part
      // and the way to get it.
      if (url.length === 0 && path.length === 0) {
        throw new Error(t('settings.voice.conversationSkillNeedsTarget'));
      }

      const action = url.length > 0 ? ({ kind: 'open-url', url } as const) : ({ kind: 'open-path', path } as const);
      const saved = await learnLocalSkill({ name, when, action });
      // Refused rather than silently kept: an address or a path this app will
      // not open is a skill that would fail later, out of context, with the user
      // believing they had taught it.
      if (!saved) throw new Error(t('settings.voice.conversationSkillRefused'));

      const detail = t('settings.voice.conversationSkillLearned', { name: saved.name });
      host.updateActivity(invocation.callId, { detail, state: 'completed' });
      host.backToListening();
      return { ok: true, detail };
    }

    if (invocation.name === 'app_find_video') {
      const query = text('query').trim();
      if (query.length === 0) throw new Error(t('settings.voice.conversationActionUnsupported'));

      host.updateActivity(invocation.callId, { detail: t('settings.voice.conversationFinding'), state: 'running' });
      const answer = await ipcBridge.application.findVideo.invoke({ query });
      const found = answer.success ? answer.data : null;

      host.updateActivity(invocation.callId, {
        detail: found ? found.title || found.url : t('settings.voice.conversationFoundNothing'),
        state: 'completed',
      });
      host.backToListening();
      // Nothing is opened and nothing is saved. The model's next turn is meant
      // to be a question — "is this the one?" — so what goes back is the title
      // to read out and the address to keep for the answer.
      if (!found) return { ok: true, found: false };
      return { ok: true, found: true, url: found.url, title: found.title };
    }

    if (invocation.name === 'app_skill_do') {
      const name = text('name').trim();
      if (name.length === 0) throw new Error(t('settings.voice.conversationActionUnsupported'));

      if (flag('forget')) {
        const dropped = await forgetLocalSkill(name);
        if (!dropped) throw new Error(t('settings.voice.conversationSkillUnknown', { name }));

        const detail = t('settings.voice.conversationSkillForgotten', { name });
        host.updateActivity(invocation.callId, { detail, state: 'completed' });
        host.backToListening();
        return { ok: true, detail };
      }

      const found = findLocalSkill(peekLocalSkills(), name);
      if (!found) throw new Error(t('settings.voice.conversationSkillUnknown', { name }));

      await runLocalSkill(found);
      const detail = t('settings.voice.conversationSkillDone', { name: found.name });
      host.updateActivity(invocation.callId, { detail, state: 'completed' });
      host.backToListening();
      return { ok: true, detail };
    }

    if (invocation.name === 'app_rule') {
      const stop = text('stop').trim();
      const rule = text('rule').trim();
      if (stop.length === 0 && rule.length === 0) throw new Error(t('settings.voice.conversationActionUnsupported'));

      if (stop.length > 0) {
        // Withdrawn from both places, because the user does not know which of
        // them it went into and should not have to. Saying "stop answering in
        // English" has to work whether it was for the session or for good.
        host.dropSessionRule(stop);
        await forgetVoiceRule(stop);

        const detail = t('settings.voice.conversationRuleDropped');
        host.updateActivity(invocation.callId, { detail, state: 'completed' });
        host.backToListening();
        return { ok: true, detail };
      }

      const keep = flag('remember');
      // The default is the narrower one. A rule that turns out to be permanent
      // is one sentence away; one that was never meant to be is something the
      // user has to notice and then undo.
      if (keep) await rememberVoiceRule(rule);
      else host.setSessionRule(rule);

      const detail = keep
        ? t('settings.voice.conversationRuleKept', { rule })
        : t('settings.voice.conversationRuleForNow', { rule });
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

    if (invocation.name === 'app_skill') {
      // Being shown how to do something, and turning it into a real skill in the
      // library rather than a note the spoken assistant follows.
      return runSkillTool(host, invocation.callId, {
        action: text('action') || 'write',
        name: text('name'),
        what: text('what'),
        steps: text('steps'),
      });
    }

    if (invocation.name === 'app_workspace') {
      // The largest thing a sentence can ask for: a page of its own, built and
      // put in a workspace the user is then moved into.
      return runWorkspaceTool(host, invocation.callId, {
        action: text('action') || 'build',
        name: text('name'),
        wanted: text('wanted'),
      });
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
