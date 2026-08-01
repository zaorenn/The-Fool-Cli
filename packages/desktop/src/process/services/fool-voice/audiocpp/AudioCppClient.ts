/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Typed client for `audiocpp_server`'s HTTP surface.
 *
 * Knows nothing about processes — {@link AudioCppRuntime} owns the child and
 * hands this class a base URL — so it can be exercised against a stub server.
 *
 * The wire contract is pinned from upstream source in
 * `docs/superpowers/specs/2026-08-01-audiocpp-http-contract.md`; the comments
 * below cite it where the shape is surprising, which is often.
 */

/** Values the server accepts inside `options`; each is stringified server-side. */
export type AudioCppOptionValue = string | number | boolean;

export type AudioCppSpeechRequest = {
  /** Id of a model entry in the server's config file, not a family name. */
  model: string;
  /** The text to speak. Upstream calls this `input`, and it is required. */
  input: string;
  /**
   * BCP-ish language code, e.g. `tr`.
   *
   * Deliberately separate from {@link options}: the server folds this into the
   * request's Transcript rather than the options map, so a model that reads its
   * language from the transcript (Chatterbox does) never sees an `options.language`.
   */
  language?: string;
  /** A configured server-side preset name, or a model-native cached voice id. */
  voice?: string;
  /**
   * Absolute path, **on the machine running the server**, to a reference WAV.
   *
   * The server reads the file itself. There is no multipart branch on this route
   * and no base64 audio field, so the bytes never travel over the wire.
   */
  voiceRef?: string;
  /** Transcript of {@link voiceRef}, for models that want one. Chatterbox does not. */
  referenceText?: string;
  /** Per-model generation knobs, snake_case, passed through untouched. */
  options?: Readonly<Record<string, AudioCppOptionValue>>;
  /** Caps how long this request waits for a model that is already busy. */
  busyTimeoutMs?: number;
};

export type AudioCppSpeechResult = {
  /** A complete RIFF/WAVE container, PCM 16-bit little-endian. */
  wav: Uint8Array;
  wallMs?: number;
  audioDurationMs?: number;
  realTimeFactor?: number;
};

export type AudioCppHealth = {
  status: string;
  backend: string;
  /** A *count* of configured models. Upstream sends a number here, not a list. */
  models: number;
};

export type AudioCppModel = {
  id: string;
  ownedBy: string;
  family: string;
  /** Framework task spelling, e.g. `clon` for cloning, `vc`, `tts`. */
  task: string;
  /** `offline` or `streaming`. */
  mode: string;
};

export type AudioCppErrorKind =
  /** The server could not be reached, or the connection broke mid-flight. */
  | 'transport'
  /** A non-2xx status. See {@link AudioCppClientError.status}. */
  | 'http'
  /** A 2xx whose body did not match the documented shape. */
  | 'malformed-response';

/**
 * Every failure this client raises.
 *
 * A `http` error is *not* reliably a server fault: upstream answers a missing
 * field or an unknown model id with 500 `server_error`, because only
 * `ServerBusyError` is caught before the generic handler. So callers must not
 * treat 5xx as "retry, it will pass" — {@link serverMessage} is the only real
 * discriminator, and it is free-form text.
 */
export class AudioCppClientError extends Error {
  public readonly kind: AudioCppErrorKind;
  public readonly status?: number;
  /** `error.type` from the server envelope, when it sent one. */
  public readonly serverType?: string;
  /** `error.message` from the server envelope, verbatim. */
  public readonly serverMessage?: string;

  public constructor(
    kind: AudioCppErrorKind,
    message: string,
    details: { status?: number; serverType?: string; serverMessage?: string; cause?: unknown } = {}
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'AudioCppClientError';
    this.kind = kind;
    this.status = details.status;
    this.serverType = details.serverType;
    this.serverMessage = details.serverMessage;
  }
}

/** The slice of `fetch` this client uses, so tests can substitute one. */
export type AudioCppFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type AudioCppClientDeps = {
  fetch?: AudioCppFetch;
  /** Abort a request that produces nothing at all. Synthesis on CPU is slow, so this is generous. */
  requestTimeoutMs?: number;
};

/** Long enough for a CPU-bound long-form synthesis, short enough to not hang forever. */
const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/** Reads a numeric response header, tolerating the trailing zeros `std::to_string` emits. */
const headerNumber = (headers: Headers, name: string): number | undefined => {
  const raw = headers.get(name);
  if (raw === null) return undefined;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** True when the bytes open with `RIFF....WAVE`, as `encode_pcm16_wav` always does. */
const looksLikeWav = (bytes: Uint8Array): boolean => {
  if (bytes.length < 12) return false;
  const tag = (offset: number): string => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  return tag(0) === 'RIFF' && tag(8) === 'WAVE';
};

export class AudioCppClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: AudioCppFetch;
  private readonly requestTimeoutMs: number;

  /**
   * @param baseUrl Origin of a running server, e.g. `http://127.0.0.1:51234`.
   *   Trailing slashes are tolerated. The port changes across restarts, so
   *   callers construct a client per {@link AudioCppRuntime.ensureRunning} result.
   */
  public constructor(baseUrl: string, deps: AudioCppClientDeps = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetchImpl = deps.fetch ?? ((input, init) => fetch(input, init));
    this.requestTimeoutMs = deps.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /**
   * Liveness, not readiness.
   *
   * The server answers as soon as it is accepting connections; with lazy loading
   * on, that is before any weights exist in memory. A green health check means
   * "the process is up", not "synthesis will be fast".
   */
  public async getHealth(): Promise<AudioCppHealth> {
    const payload = await this.requestJson('/health', { method: 'GET' });
    const status = asString(payload.status);
    const backend = asString(payload.backend);
    const models = payload.models;
    if (status === undefined || backend === undefined || typeof models !== 'number') {
      throw new AudioCppClientError('malformed-response', 'health response did not match the documented shape');
    }
    return { status, backend, models };
  }

  /** The models the running server was configured with. */
  public async listModels(): Promise<readonly AudioCppModel[]> {
    const payload = await this.requestJson('/v1/models', { method: 'GET' });
    const data = payload.data;
    if (payload.object !== 'list' || !Array.isArray(data)) {
      throw new AudioCppClientError('malformed-response', 'model list response did not match the documented shape');
    }
    return data.map((entry): AudioCppModel => {
      if (!isRecord(entry)) {
        throw new AudioCppClientError('malformed-response', 'model list contained a non-object entry');
      }
      const id = asString(entry.id);
      const ownedBy = asString(entry.owned_by);
      const family = asString(entry.family);
      const task = asString(entry.task);
      const mode = asString(entry.mode);
      if (
        id === undefined ||
        ownedBy === undefined ||
        family === undefined ||
        task === undefined ||
        mode === undefined
      ) {
        throw new AudioCppClientError('malformed-response', 'model list entry was missing documented fields');
      }
      return { id, ownedBy, family, task, mode };
    });
  }

  /**
   * Renders one passage to a WAV.
   *
   * Sends no `response_format`, taking the default binary `audio/wav` reply:
   * the JSON variant returns the same file base64-encoded, which is a third
   * larger for no benefit here.
   */
  public async synthesize(request: AudioCppSpeechRequest): Promise<AudioCppSpeechResult> {
    const response = await this.send('/v1/audio/speech', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(speechBody(request)),
    });
    if (!response.ok) throw await httpError(response);

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('audio/')) {
      throw new AudioCppClientError(
        'malformed-response',
        `expected audio from /v1/audio/speech, got "${contentType}"`,
        {
          status: response.status,
        }
      );
    }
    const wav = new Uint8Array(await this.readBody(response));
    if (!looksLikeWav(wav)) {
      throw new AudioCppClientError('malformed-response', 'speech response was not a RIFF/WAVE container', {
        status: response.status,
      });
    }
    return {
      wav,
      wallMs: headerNumber(response.headers, 'x-audiocpp-wall-ms'),
      audioDurationMs: headerNumber(response.headers, 'x-audiocpp-audio-duration-ms'),
      realTimeFactor: headerNumber(response.headers, 'x-audiocpp-rtf'),
    };
  }

  private async requestJson(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    const response = await this.send(path, init);
    if (!response.ok) throw await httpError(response);
    const text = await this.readText(response);
    const parsed = parseJson(text);
    if (!isRecord(parsed)) {
      throw new AudioCppClientError('malformed-response', `expected a JSON object from ${path}`, {
        status: response.status,
      });
    }
    return parsed;
  }

  private async send(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, signal: controller.signal });
    } catch (cause) {
      throw new AudioCppClientError('transport', `could not reach audio.cpp at ${this.baseUrl}${path}`, { cause });
    } finally {
      clearTimeout(timer);
    }
  }

  private async readBody(response: Response): Promise<ArrayBuffer> {
    try {
      return await response.arrayBuffer();
    } catch (cause) {
      throw new AudioCppClientError('transport', 'audio.cpp response body could not be read', { cause });
    }
  }

  private async readText(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch (cause) {
      throw new AudioCppClientError('transport', 'audio.cpp response body could not be read', { cause });
    }
  }
}

/**
 * Builds the request body, omitting everything the caller left unset.
 *
 * Generation params stay *nested* under `options`. The server also promotes nine
 * well-known knobs from the top level, but it applies those promotions after
 * copying `options`, so a flat copy would silently shadow the nested one. One
 * place, one precedence, no surprise. `text_chunk_size` and `do_sample` have no
 * flat alias at all, so nesting is the only shape that works for every key.
 */
const speechBody = (request: AudioCppSpeechRequest): Record<string, unknown> => {
  const body: Record<string, unknown> = { model: request.model, input: request.input };
  if (request.language !== undefined) body.language = request.language;
  if (request.voice !== undefined) body.voice = request.voice;
  if (request.voiceRef !== undefined) body.voice_ref = request.voiceRef;
  if (request.referenceText !== undefined) body.reference_text = request.referenceText;
  if (request.busyTimeoutMs !== undefined) body.busy_timeout_ms = request.busyTimeoutMs;
  if (request.options !== undefined && Object.keys(request.options).length > 0) {
    body.options = { ...request.options };
  }
  return body;
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new AudioCppClientError('malformed-response', 'audio.cpp returned a body that is not valid JSON', { cause });
  }
};

/**
 * Turns a non-2xx into a typed error, pulling `{error:{message,type}}` out when
 * the server sent one and falling back to the raw text when it did not.
 */
const httpError = async (response: Response): Promise<AudioCppClientError> => {
  const text = await response.text().catch(() => '');
  let serverMessage: string | undefined;
  let serverType: string | undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed) && isRecord(parsed.error)) {
      serverMessage = asString(parsed.error.message);
      serverType = asString(parsed.error.type);
    }
  } catch {
    // Not the documented envelope; the status and raw text are all we have.
  }
  const detail = serverMessage ?? text.trim();
  return new AudioCppClientError('http', `audio.cpp returned ${response.status}${detail === '' ? '' : `: ${detail}`}`, {
    status: response.status,
    serverType,
    serverMessage,
  });
};
