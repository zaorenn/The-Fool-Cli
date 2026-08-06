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
  /** Whole display, or only this window. */
  source: 'window' | 'screen';
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

/** PNG bytes of the requested surface, as a data URL. */
const capture = async (source: 'window' | 'screen'): Promise<string> => {
  const grab = source === 'screen' ? window.electronAPI?.captureScreen : window.electronAPI?.captureFeedbackScreenshot;
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
  return `data:image/png;base64,${btoa(binary)}`;
};

/**
 * Looks at the screen and answers the question about it.
 *
 * @throws {ScreenSightError} for every way this can fail, each with a reason the
 *   caller can turn into something the user can act on.
 */
export const describeScreen = async (request: ScreenSightRequest): Promise<string> => {
  const imageUrl = await capture(request.source);

  const timeout = AbortSignal.timeout(DESCRIBE_TIMEOUT_MS);
  const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(`${request.endpoint}/chat/completions`, {
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
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
        temperature: DESCRIBE_TEMPERATURE,
        max_tokens: DESCRIBE_MAX_TOKENS,
      }),
    });
  } catch (error) {
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
  return text;
};
