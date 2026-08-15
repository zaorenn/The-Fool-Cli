/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { configService } from '@/common/config/configService';
import { isValidHexColor } from '@/common/config/themeOverrides';
import { nearestPalette, paletteForRequest, PALETTES, type ThemePalette } from '@/common/theme/palettes';
import { parseOpenUrls } from '@/common/realtime/openUrls';
import { buildSiteSearch } from '@/common/realtime/siteSearch';
import { isGranted, sanitizeConnectorGrants, CONNECTOR_GRANTS_CONFIG_KEY } from '@/common/permissions/connectors';
import { isSearchableAppName } from '@/common/voice/appLaunch';
import { choosePlayRoute, type PlayOutcome } from '@/common/voice/playRequest';
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
import { describeScreen, ScreenSightError, takeScreenLook } from '@renderer/services/voice/screenSight';
import { peekVoiceSettings } from '@renderer/services/voice/voiceSettingsStore';
import { applySurfaceIntent, readSurfaceIntent, type SurfaceIntent } from '@/common/theme/surfaceIntent';
import { defaultSurfaceChoice, type SurfaceStyleChoice } from '@/common/theme/surfaceChoice';
import { peekSurfaceChoice, SURFACE_STYLE_CONFIG_KEY } from '@renderer/hooks/config/useSurfaceStyle';
import { normalizeEndpoint } from '../localPipeline';
import { buildAndPreview } from './buildTool';
import { documentName, openDocument } from './documentTool';
import { runResearchTool } from './researchTool';
import { fillPdfWithQuestions, type KnownValue, type PdfFillOutcome } from './pdfTool';
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
 * Writes a material choice the way the panel does.
 *
 * Through `configService` rather than onto the document, so the change reaches
 * every window and survives a restart — the same path the settings panel takes.
 * The hook applies it to the page when the store tells it to.
 */
const writeSurfaceChoice = async (choice: SurfaceStyleChoice): Promise<void> => {
  await configService.set(SURFACE_STYLE_CONFIG_KEY, choice);
};

/**
 * Changes the app's colour, material or movement, as asked out loud.
 *
 * Colour is a palette now, not a hex value. There used to be a `set` action
 * that took any colour the model chose and wrote it to `--color-bg-*` through
 * the override layer. Two things were wrong with it, and both were reported by
 * the user rather than caught here:
 *
 * The override layer asserts nothing since the colour customiser was removed,
 * so `set` with a target of background, surface or text wrote a config value,
 * painted no pixel, and returned "theme set". Asked out loud to make the app
 * green, it said it had and nothing moved.
 *
 * And an arbitrary hex from a model is exactly the unbounded colour space the
 * closed list exists to close. The nine palettes are checked against all seven
 * materials in both appearances; a tenth colour invented in a sentence is
 * checked against nothing. So a colour that is named is matched to the nearest
 * of the nine rather than used as given.
 */
export const applyThemeAction = async (
  t: ToolHost['t'],
  action: string,
  palette: string,
  color: string,
  intent: SurfaceIntent = {}
): Promise<string> => {
  if (action === 'reset') {
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

  if (action === 'palette') {
    const chosen = resolvePalette(palette, color);
    if (!chosen) throw new Error(t('settings.voice.conversationThemeBadColor'));

    // The accent is the seed the whole palette is derived from, so writing it is
    // writing the palette — ground, card and ink all follow from it.
    await writeSurfaceChoice({ ...peekSurfaceChoice(), accent: chosen.seed });
    return t('settings.voice.conversationThemePalette', { name: t(chosen.name) });
  }

  throw new Error(t('settings.voice.conversationActionUnsupported'));
};

/**
 * The palette a spoken request meant, from whatever the model actually sent.
 *
 * Three spellings of the same intent, because a small local model asked for an
 * enum sends the enum some of the time and the user's own word the rest of it:
 * an id (`moss`), a colour word in any language this app speaks (`green`,
 * `yeşil`), or a hex value it invented. All three land on one of the nine, and
 * `null` means it named no colour at all rather than "use the first one".
 */
export const resolvePalette = (palette: string, color: string): ThemePalette | null => {
  const asked = palette.trim().toLowerCase();
  const exact = PALETTES.find((entry) => entry.id === asked);
  if (exact) return exact;

  const byWord = asked.length > 0 ? paletteForRequest(asked) : null;
  if (byWord) return byWord;

  const hex = color.trim().toLowerCase();
  if (isValidHexColor(hex)) return nearestPalette(hex);

  // A colour word can also arrive in the `color` field rather than the hex one.
  return color.trim().length > 0 ? paletteForRequest(color) : null;
};

/**
 * Looks at the screen and hands back what is there, in words.
 *
 * The model doing the looking is a separate setting from the one holding the
 * conversation, defaulting to it: the fast conversational model is often
 * text-only, and a picture sent to one is refused rather than ignored.
 */
export const lookAtScreen = async (
  question: string,
  windowMatch = ''
): Promise<{ text: string; scope: 'window' | 'display' }> => {
  // Started the moment the user's words pointed at a screen, which is a whole
  // model round trip before this call exists. Usually already answered — but
  // only for the wide look it started, so a question about one named window
  // takes its own picture rather than reading the whole desktop again.
  const alreadyLooking = windowMatch.trim().length > 0 ? null : takeScreenLook();
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
    // Narrower still when a window was named, which is the case worth having:
    // one application's window is what the question was about, and it is less
    // of the user's screen than handing over all of it.
    windowMatch,
  });
};

/**
 * Whether the user has connected a music service and allowed it to be driven.
 *
 * Both halves are asked, and they are different questions. The tokens live in
 * the main process, so only it can say whether an account is attached; the
 * *permission* is the user's answer in settings, kept beside every other
 * connector grant. A connection without the grant is an account somebody linked
 * and has not said may be used, and starting their music anyway is exactly the
 * thing `common/permissions/connectors.ts` was written to prevent.
 */
const mayPlayOnSpotify = async (): Promise<boolean> => {
  const grants = sanitizeConnectorGrants(configService.get(CONNECTOR_GRANTS_CONFIG_KEY));
  if (!isGranted(grants, { connector: 'spotify', capability: 'playback.control' })) return false;

  const status = await ipcBridge.spotify.status.invoke();
  return status.success === true && status.data?.connected === true;
};

/**
 * Plays something, in the background, and reports only what actually happened.
 *
 * The order is the whole design. A connected music service first, because it
 * plays where the user's music already comes from and can say what is on; the
 * default browser second, because a page opening is instant and honest. The
 * pointer is never used, at any point, for either.
 *
 * The failure path is the part worth reading. When the service is connected and
 * refuses — nothing open to play on, a free account, a track it does not have —
 * the browser still gets the request, so the user ends up with something rather
 * than an apology. What comes back then says `playing: false`, because a page
 * opening is not a song starting, and the claim gate reads that field.
 */
const playSomething = async (t: ToolHost['t'], what: string, address: string): Promise<PlayOutcome> => {
  const route = choosePlayRoute({ what, address, spotifyConnected: await mayPlayOnSpotify() });
  if (route.kind === 'nothing') return { ok: false, error: t('settings.voice.conversationActionUnsupported') };

  if (route.kind === 'spotify') {
    const answer = await ipcBridge.spotify.play.invoke({ query: route.query, uri: route.uri ?? undefined });
    const played = answer.success ? answer.data : null;
    if (played?.ok === true) return { ok: true, playing: true, track: played.track, device: played.device };

    // It could not play there, so it falls through to the browser rather than
    // stopping — with the reason carried along, which is how the assistant gets
    // to say "Spotify is not open anywhere, so I have opened it in your browser"
    // instead of either lying or giving up.
    const fallback = choosePlayRoute({ what, address, spotifyConnected: false });
    if (fallback.kind !== 'browser') return { ok: false, error: t('settings.voice.conversationActionUnsupported') };

    await ipcBridge.shell.openExternal.invoke(fallback.url);
    return {
      ok: true,
      playing: false,
      opened: true,
      url: fallback.url,
      reason: played?.ok === false ? played.reason : 'not-connected',
    };
  }

  await ipcBridge.shell.openExternal.invoke(route.url);
  // No `reason`: nothing went wrong, this is simply what playing looks like
  // without a connected service. The model is told it opened a page, which is
  // the only sentence it is then allowed to say — and that it may *ask* about
  // connecting one, which is a question, not a sign-in.
  return { ok: true, playing: false, opened: true, url: route.url, offerSpotify: true };
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
 * The values a model claims to already have, taken at arm's length.
 *
 * Everything here arrives as parsed JSON from a language model, so the shape is
 * a hope rather than a fact: entries that are not a pair of strings are dropped
 * instead of being coerced into one. A dropped entry is not lost — the field it
 * was meant for is required and empty, so it becomes a question.
 */
const readKnownValues = (raw: unknown): KnownValue[] => {
  if (!Array.isArray(raw)) return [];

  const values: KnownValue[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    // `field` is the schema; `name` is what a small local model sends anyway.
    const field = record.field ?? record.name;
    const value = record.value;
    if (typeof field !== 'string' || typeof value !== 'string') continue;
    values.push({ field, value });
  }
  return values;
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
      const detail = await applyThemeAction(t, text('action'), text('palette'), text('color'), readSurfaceIntent(args));
      host.updateActivity(invocation.callId, { detail, state: 'completed' });
      host.backToListening();
      return { ok: true, detail };
    }

    if (invocation.name === 'app_look_at_screen') {
      host.updateActivity(invocation.callId, { detail: t('settings.voice.conversationLooking'), state: 'running' });
      const wanted = text('window').trim();

      let look: { text: string; scope: 'window' | 'display' };
      try {
        look = await lookAtScreen(text('question'), wanted);
      } catch (error) {
        // Not a failure, and it must not be reported as one. A window that is
        // not open is the answer to the question, and it is the answer this
        // application used to replace with a photograph of everything else the
        // user had on screen — described confidently as the thing they asked
        // about.
        if (error instanceof ScreenSightError && error.reason === 'window-not-open') {
          const detail = t('settings.voice.conversationWindowNotOpen', { name: wanted });
          host.updateActivity(invocation.callId, { detail, state: 'completed' });
          host.backToListening();
          return { ok: true, windowNotOpen: wanted, detail };
        }
        throw error;
      }
      host.updateActivity(invocation.callId, { detail: look.text.slice(0, 160), state: 'completed' });
      host.backToListening();
      // Handed back as the screen's own words rather than a summary of them: the
      // model is about to say this out loud in its own voice, and summarising it
      // here would be a second, worse rewrite.
      //
      // `lookedAt` is the other half, and it is the honest half — what was
      // actually photographed, so the model cannot report a look at one window
      // when a display was captured.
      return { ok: true, screen: look.text, lookedAt: look.scope };
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

    if (invocation.name === 'app_play') {
      const outcome = await playSomething(t, text('what'), text('url'));
      host.updateActivity(invocation.callId, {
        detail:
          outcome.ok === false
            ? outcome.error
            : outcome.playing
              ? t('settings.voice.conversationPlaying', { track: outcome.track, device: outcome.device })
              : t('settings.voice.conversationOpenedToPlay'),
        state: outcome.ok === false ? 'failed' : 'completed',
      });
      host.backToListening();
      // Handed back exactly as it happened. `playing: false` beside an address
      // is the whole truth about a page that opened, and it is what the claim
      // gate reads to refuse "it should now be playing".
      return { ...outcome };
    }

    if (invocation.name === 'app_connect') {
      const service = text('service').trim() || 'spotify';
      if (service !== 'spotify') throw new Error(t('settings.voice.conversationActionUnsupported'));

      // The consent gate, in code rather than in the description. Called without
      // it, this opens nothing and answers with the question to ask — so the
      // worst a model that reached for it unprompted can do is be told to ask
      // first, instead of a sign-in window appearing on somebody's screen for a
      // reason they never agreed to.
      if (!flag('confirmed')) {
        const ask = t('settings.voice.conversationConnectAsk');
        host.updateActivity(invocation.callId, { detail: ask, state: 'completed' });
        host.backToListening();
        return { ok: true, connected: false, mustAskFirst: true, ask };
      }

      const before = await ipcBridge.spotify.status.invoke();
      // Nothing can be started without the user's own application id, and there
      // is no honest one to compile in. Named as a place in settings rather than
      // as a failure, because it is a thing they have to go and do.
      if (before.success !== true || before.data?.hasClientId !== true) {
        throw new Error(t('settings.voice.conversationConnectNeedsClientId'));
      }

      host.updateActivity(invocation.callId, {
        detail: t('settings.voice.conversationConnectWaiting'),
        state: 'running',
      });
      // Their browser, their password manager, their sign-in. This application
      // has no code path that types a credential and must never grow one.
      const answer = await ipcBridge.spotify.connect.invoke();
      if (answer.success !== true) throw new Error(t('settings.voice.conversationConnectFailed'));

      const detail = t('settings.voice.conversationConnected');
      host.updateActivity(invocation.callId, { detail, state: 'completed' });
      host.backToListening();
      return { ok: true, connected: true, detail };
    }

    if (invocation.name === 'app_open_app') {
      const spoken = text('name').trim();
      const action = text('action') === 'close' ? 'close' : 'open';
      // Refused here as well as in the main process, because here there is
      // somebody to tell: an empty or absurd name is a request this tool does
      // not take, not a launch that quietly did nothing.
      //
      // The *searchable* rule, not the launchable one. The launchable set has no
      // apostrophe in it, and a Turkish speaker saying "Spotify'ı aç" has the
      // model hand over `Spotify'ı` — refused outright, for a word that is
      // unmistakably Spotify. Nothing here reaches a command: the name is
      // matched against a list the operating system wrote, and the strict set
      // still guards the fallback that does build one.
      if (!isSearchableAppName(spoken)) throw new Error(t('settings.voice.conversationAppBadName'));

      const answer = await ipcBridge.application.controlApp.invoke({ name: spoken, action });
      // Told apart rather than lumped together: "it was not running" is a true
      // and useful sentence, and reporting it as "I could not close it" would be
      // the assistant apologising for a thing that was already the case.
      if (!answer.success) {
        throw new Error(
          answer.msg === 'not-running'
            ? t('settings.voice.conversationAppNotRunning', { name: spoken })
            : t('settings.voice.conversationAppCouldNotOpen', { name: spoken })
        );
      }

      // What the system calls it, when the index recognised it. "open vs code"
      // is answered with "opened Visual Studio Code", which is a report; echoing
      // `vs code` back would only prove the words were received.
      const name = answer.data?.name || spoken;
      const detail =
        action === 'close'
          ? t('settings.voice.conversationAppClosed', { name })
          : t('settings.voice.conversationAppOpened', { name });
      host.updateActivity(invocation.callId, { detail, state: 'completed' });
      host.backToListening();
      return { ok: true, detail };
    }

    if (invocation.name === 'app_fill_pdf') {
      const path = text('path').trim();
      if (path.length === 0) throw new Error(t('settings.voice.conversationActionUnsupported'));

      host.updateActivity(invocation.callId, {
        detail: t('settings.voice.conversationPdfReading'),
        state: 'running',
      });

      // Filling a form is minutes long when it has to stop and ask, so the
      // conversation is told it is still going rather than left silent — this
      // application has learned that a long silence reads as a crash.
      const stopHeartbeat = host.startWorkingHeartbeat();
      let outcome: PdfFillOutcome;
      try {
        outcome = await fillPdfWithQuestions(t, path, readKnownValues(args.values), invocation.callId, (detail) =>
          host.updateActivity(invocation.callId, { detail, state: 'running' })
        );
      } finally {
        stopHeartbeat();
      }

      if (outcome.status === 'failed') throw new Error(outcome.error);

      // The two halves of the truth, kept together. `unfilled` is what stops
      // the model calling a form complete when part of it is still empty, so it
      // is in the detail the user sees and in the result the model reads.
      const detail =
        outcome.unfilled.length === 0
          ? t('settings.voice.conversationPdfFilled', { count: outcome.filled })
          : t('settings.voice.conversationPdfPartly', {
              count: outcome.filled,
              missing: outcome.unfilled.join(', '),
            });
      host.updateActivity(invocation.callId, { detail, state: 'completed' });
      host.backToListening();
      return {
        ok: true,
        detail,
        writtenTo: outcome.writtenTo,
        filled: outcome.filled,
        stillEmpty: outcome.unfilled,
      };
    }

    if (invocation.name === 'app_write_document') {
      const markdown = text('markdown').trim();
      const format = text('format').trim();
      if (markdown.length === 0 || format.length === 0) {
        throw new Error(t('settings.voice.conversationActionUnsupported'));
      }

      host.updateActivity(invocation.callId, {
        detail: t('settings.voice.conversationWritingDocument', { format }),
        state: 'running',
      });

      const written = await ipcBridge.application.writeDocument.invoke({
        markdown,
        format,
        name: text('name').trim(),
      });
      if (!written.success) throw new Error(t('settings.voice.conversationDocumentFailed'));

      const file = written.data?.path ?? '';
      const name = file.replace(/^.*[\\/]/, '');
      host.updateActivity(invocation.callId, {
        detail: t('settings.voice.conversationDocumentWritten', { name }),
        state: 'completed',
      });
      host.backToListening();

      // `complete` travels back so the assistant can say the one thing that
      // matters and that only it knows: a PDF written without a Unicode face
      // has lost every ı, ş and ğ, and a name mangled in a filed document is
      // worse than a document that was never written.
      return {
        ok: true,
        writtenTo: name,
        lettersIntact: written.data?.complete !== false,
        detail: t('settings.voice.conversationDocumentWritten', { name }),
      };
    }

    if (invocation.name === 'app_research') {
      const question = text('question').trim();
      if (question.length === 0) throw new Error(t('settings.voice.conversationActionUnsupported'));

      // Named while it runs rather than after. Reading three pages is a couple
      // of seconds of a spoken conversation, and a couple of seconds of nothing
      // is how this application has learned a wait reads as a crash.
      host.updateActivity(invocation.callId, {
        label: question,
        detail: t('settings.voice.conversationResearching', { question }),
        state: 'running',
      });

      const answer = await ipcBridge.application.research.invoke({ question });
      const digest = answer.success ? (answer.data?.digest ?? '') : '';
      const sources = answer.success ? (answer.data?.sources ?? []) : [];

      if (digest.length === 0) {
        host.updateActivity(invocation.callId, {
          detail: t('settings.voice.conversationResearchNothing'),
          state: 'completed',
        });
        host.backToListening();
        // Reported as a *result* and not as a failure, because it is one: the
        // model has to be able to say "I looked and could not find it", and a
        // thrown error is the shape it papers over with a guess.
        return { ok: true, found: false, detail: t('settings.voice.conversationResearchNothing') };
      }

      host.updateActivity(invocation.callId, {
        detail: t('settings.voice.conversationResearchRead', { count: sources.length }),
        state: 'completed',
      });
      host.backToListening();

      // The digest carries its own instruction to answer from it and nothing
      // else — see `buildDigest`. It rides in the tool result rather than the
      // system prompt because it is true of this text and no other.
      return { ok: true, found: true, sources, evidence: digest };
    }

    if (invocation.name === 'app_find_document') {
      // The request this application answered worst: "find me a PDF about X".
      // Nothing here opens the user's browser — the search is fetched, the file
      // is saved, and the viewer is the one beside the conversation.
      const found = await runResearchTool(host, invocation.callId, {
        query: text('query'),
        kind: text('kind'),
        // Models send the word as often as the boolean, and both mean the same
        // thing. `open` absent on a request that plainly wanted the document
        // would report a list of links and call it done.
        open: flag('open'),
      });
      if (found.ok === false) return { ok: false, error: found.error };
      return {
        ok: true,
        results: found.found.map((result) => ({ title: result.title, summary: result.snippet })),
        ...(found.opened ? { opened: found.opened.name, showing: true } : { showing: false }),
      };
    }

    if (invocation.name === 'app_open_document') {
      const path = text('path').trim();
      if (path.length === 0) throw new Error(t('settings.voice.conversationActionUnsupported'));

      const opened = await openDocument(path);
      // Null is "there is no viewer for this", which is a true sentence and a
      // different one from "it failed". It is deliberately not answered by
      // handing the file to the operating system: a document opened in some
      // other program is one this assistant cannot see or talk about.
      if (!opened) {
        const detail = t('settings.voice.conversationDocumentNoViewer', { name: documentName(path) });
        host.updateActivity(invocation.callId, { detail, state: 'completed' });
        host.backToListening();
        return { ok: true, showing: false, detail };
      }

      const detail = t('settings.voice.conversationDocumentOpened', { name: opened.name });
      host.updateActivity(invocation.callId, { detail, state: 'completed' });
      host.backToListening();
      return { ok: true, showing: true, opened: opened.name, viewer: opened.viewer };
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
