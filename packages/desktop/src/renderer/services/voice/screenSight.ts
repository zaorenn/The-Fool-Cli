/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What is on the screen, in words, for a conversation to say out loud.
 *
 * A spoken assistant that cannot see the screen is limited to what the user can
 * describe, which is the opposite of the point — "look at this" is the most
 * natural thing to say to something sitting on your desktop. So the display is
 * captured and handed to a model that reads images, and the answer comes back as
 * a sentence the conversation can speak.
 *
 * The picture never leaves the machine: the capture is local, and the model that
 * reads it is the one on the loopback endpoint the conversation is already
 * talking to.
 */

import { mayAskForNoDeliberation, noDeliberation, refusedTheField, rememberRefusal } from '@/common/realtime/reasoning';

const DESCRIBE_TIMEOUT_MS = 120_000;

/**
 * Room for the answer *after* the model has finished thinking.
 *
 * Measured rather than picked: at 300 the reply came back empty with
 * `finish_reason: "length"` because the model had spent every token in
 * `reasoning_content` — a screen it had genuinely read and could not report. It
 * spends around 1,800 characters of that on a screenshot, so the budget has to
 * clear the deliberation and still leave the sentences.
 */
const DESCRIBE_MAX_TOKENS = 1200;

/** Low, because this is a report about a real picture, not a piece of writing. */
const DESCRIBE_TEMPERATURE = 0.3;

export type ScreenSightRequest = {
  /** What the user wants to know, in their own words. Empty asks for a summary. */
  question: string;
  /** OpenAI-dialect base, already normalised — e.g. `http://127.0.0.1:1234/v1`. */
  endpoint: string;
  /** The model that reads the image. */
  model: string;
  /** The language the answer is spoken in. */
  language: string;
  /** Whole display, or only this app's own window. */
  source: 'window' | 'screen';
  /**
   * One application's window to look at instead of the whole display.
   *
   * Preferred over `source` when it matches something on screen. Almost every
   * spoken question is about a single window — "what does that error say", "did
   * it finish" — and a photograph of the whole desktop gives the model several
   * things it might be reading and no way to choose between them. A name that
   * matches nothing falls back to `source`, so this can only narrow the picture.
   */
  windowMatch?: string;
  signal?: AbortSignal;
};

export type ScreenSightFailure =
  /** No capture is available — a browser build, or the preload did not load. */
  | 'capture-unavailable'
  /** The capture itself failed or came back empty. */
  | 'capture-failed'
  /** The endpoint refused the request; usually a text-only model. */
  | 'model-refused'
  /** The model answered, with nothing in it. */
  | 'no-description';

export class ScreenSightError extends Error {
  public readonly reason: ScreenSightFailure;
  /** The server's own words, when it sent any, for the activity line. */
  public readonly detail?: string;

  public constructor(reason: ScreenSightFailure, detail?: string) {
    super(`SCREEN_SIGHT_${reason.toUpperCase().replaceAll('-', '_')}`);
    this.name = 'ScreenSightError';
    this.reason = reason;
    this.detail = detail;
  }
}

/**
 * The instructions that keep the answer speakable.
 *
 * Written against a real model rather than imagined: without the last two
 * clauses it answers with a markdown outline of window titles, which read aloud
 * is a list of punctuation.
 */
const systemPrompt = (language: string): string =>
  [
    'You are the eyes of a spoken assistant, looking at the screen for someone who cannot see it.',
    'Answer in at most three short sentences of plain spoken language.',
    'Name what is actually there — the application, the page, the text that matters.',
    'No markdown, no lists, no headings, and do not describe your own reasoning.',
    language === 'auto' ? 'Answer in the language of the question.' : `Answer in ${language}.`,
  ].join(' ');

/**
 * What was photographed, which is not always what was asked for.
 *
 * The main process falls back to the whole display when a name matches no open
 * window, and it says so in the filename: `window-…` or `screen-…`. Measured
 * against the running app — `captureWindow('Fool')` returns 314KB named
 * `window-…`, `captureWindow('zzzz')` returns 1.76MB named `screen-…`.
 *
 * That distinction has to reach the caller. Without it a look at "Spotify" that
 * found no Spotify window comes back as an ordinary description, and the
 * assistant reports having looked at Spotify — the unverified claim this
 * application is built against, arrived at through a photograph rather than a
 * sentence.
 */
export type CaptureScope = 'window' | 'display';

/** PNG bytes of the requested surface, as a data URL, with what it turned out to be. */
const capture = async (
  source: 'window' | 'screen',
  windowMatch: string
): Promise<{ url: string; scope: CaptureScope }> => {
  const byWindow = window.electronAPI?.captureWindow;
  // A named window first, and the wider picture only when there is no name or
  // no way to take it. The narrow one answers the question that was asked and
  // shows the model less of the user's screen than the question needed.
  const grab =
    windowMatch.trim().length > 0 && typeof byWindow === 'function'
      ? () => byWindow(windowMatch.trim())
      : source === 'screen'
        ? window.electronAPI?.captureScreen
        : window.electronAPI?.captureFeedbackScreenshot;
  if (typeof grab !== 'function') throw new ScreenSightError('capture-unavailable');

  let shot: { filename: string; data: number[] } | null | undefined;
  try {
    shot = await grab();
  } catch (error) {
    throw new ScreenSightError('capture-failed', error instanceof Error ? error.message : undefined);
  }
  if (!shot || shot.data.length === 0) throw new ScreenSightError('capture-failed');

  const bytes = new Uint8Array(shot.data);
  // In blocks, because a screenshot is megabytes and `fromCharCode` applied to
  // the whole array at once overflows the argument list.
  let binary = '';
  const BLOCK = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += BLOCK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BLOCK));
  }
  return {
    url: `data:image/png;base64,${btoa(binary)}`,
    // The main process names what it took. A window was asked for and a screen
    // came back means the window was not open.
    scope: shot.filename.startsWith('window-') ? 'window' : 'display',
  };
};

/**
 * Looks at the screen and answers the question about it.
 *
 * There is no preloaded capture behind this any more, and its absence is the
 * point. A photograph used to be taken the moment the microphone heard speech,
 * on the theory that the head start was free — it was not. It was a picture of
 * the user's whole display for every sentence they spoke, taken before anyone
 * knew whether the sentence was about a screen, and discarded unread in nearly
 * all of them. Every capture now belongs to a question that already exists.
 *
 * @throws {ScreenSightError} for every way this can fail, each with a reason the
 *   caller can turn into something the user can act on.
 */
export const describeScreen = async (request: ScreenSightRequest): Promise<{ text: string; scope: CaptureScope }> => {
  const windowMatch = (request.windowMatch ?? '').trim();
  const taken = await capture(request.source, windowMatch);

  const timeout = AbortSignal.timeout(DESCRIBE_TIMEOUT_MS);
  const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;

  const ask = (skipDeliberation: boolean): Promise<Response> =>
    fetch(`${request.endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        model: request.model,
        messages: [
          { role: 'system', content: systemPrompt(request.language) },
          {
            role: 'user',
            content: [
              { type: 'text', text: request.question.trim() || 'What is on the screen right now?' },
              { type: 'image_url', image_url: { url: taken.url } },
            ],
          },
        ],
        temperature: DESCRIBE_TEMPERATURE,
        max_tokens: DESCRIBE_MAX_TOKENS,
        // The reason `max_tokens` had to be raised to 1,200: the model was
        // spending its whole budget deliberating and reporting a screen it had
        // genuinely read as empty. Asked not to deliberate it answers at once,
        // and the budget is room for sentences again.
        ...(skipDeliberation ? noDeliberation(request.endpoint) : {}),
      }),
    });

  let response: Response;
  try {
    response = await ask(true);
    // Only a 400 is inspected: it is the one status the field can be refused
    // with, and a body read here cannot be read again below.
    if (!response.ok && response.status === 400 && mayAskForNoDeliberation(request.endpoint)) {
      const complaint = await response.text().catch((): string => '');
      if (refusedTheField(response.status, complaint)) {
        rememberRefusal(request.endpoint);
        response = await ask(false);
      } else {
        throw new ScreenSightError('model-refused', complaint.slice(0, 300) || `HTTP ${response.status}`);
      }
    }
  } catch (error) {
    if (error instanceof ScreenSightError) throw error;
    throw new ScreenSightError('model-refused', error instanceof Error ? error.message : undefined);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ScreenSightError('model-refused', body.slice(0, 300) || `HTTP ${response.status}`);
  }

  type SightReply = { choices?: { message?: { content?: unknown } }[] };
  const payload = await (response.json() as Promise<SightReply>).catch((): SightReply => ({}));
  const content = payload.choices?.[0]?.message?.content;
  const text = typeof content === 'string' ? content.trim() : '';
  // A model that thought about the picture and ran out of room before saying
  // anything is the one failure worth naming separately: retrying with a bigger
  // budget is the fix, and the caller cannot know that from a generic error.
  if (text.length === 0) throw new ScreenSightError('no-description');
  return { text, scope: taken.scope };
};

/**
 * A look started before anything asked for one.
 *
 * "Ekranıma bak" used to cost two model round trips in a row: the conversation
 * had to finish a turn deciding to call the tool, and only then was the screen
 * captured and sent. The user sat through both, watching a screen they had
 * already asked about.
 *
 * Neither the capture nor the picture depends on that decision. The moment the
 * words plainly point at a screen — which `refersToScreen` already works out,
 * one line before the turn begins — the photograph is taken and the question is
 * put to the model that reads it, in parallel with the turn that is about to
 * ask for exactly this. By the time the tool call arrives the answer is usually
 * already in hand.
 *
 * One slot, not a queue. Two looks in flight would mean two screenshots of two
 * different moments, and the one that came back second would answer a question
 * about a screen that had moved on.
 */

/** How long a look started ahead of the request stays worth using. */
export const LOOK_AHEAD_TTL_MS = 45_000;

type StartedLook = { startedAt: number; answer: Promise<{ text: string; scope: CaptureScope }> };

let started: StartedLook | null = null;

/**
 * Starts looking now, for a request that has not been made yet.
 *
 * Does nothing when a look is already in flight: the second caller wants the
 * same screen as the first, and the first has a head start.
 */
export const beginScreenLook = (request: ScreenSightRequest): void => {
  if (started !== null && Date.now() - started.startedAt < LOOK_AHEAD_TTL_MS) return;

  const answer = describeScreen(request);
  // Nobody may ever await this. An unhandled rejection in a conversation is a
  // crash in a window the user is not looking at.
  void answer.catch((): undefined => undefined);
  started = { startedAt: Date.now(), answer };
};

/**
 * The look already under way, if there is one worth having.
 *
 * Handed over rather than shared: whoever takes it owns it, and the next
 * question about the screen deserves a fresh photograph.
 */
export const takeScreenLook = (): Promise<{ text: string; scope: CaptureScope }> | null => {
  if (started === null) return null;

  const taken = started;
  started = null;
  // A picture of the screen as it was a minute ago is not an answer about the
  // screen. Past the window it is thrown away rather than reported.
  return Date.now() - taken.startedAt > LOOK_AHEAD_TTL_MS ? null : taken.answer;
};

/** Drops anything in flight, for a conversation that has ended or been cut off. */
export const forgetScreenLook = (): void => {
  started = null;
};
