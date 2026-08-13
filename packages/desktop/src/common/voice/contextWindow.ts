/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * How much the local model can actually read, asked rather than assumed.
 *
 * `contextBudget.ts` says the window has to be guessed because "LM Studio and
 * the OpenAI-compatible endpoints it imitates do not report the loaded context
 * length". Half of that is true and the half that matters is not.
 *
 * Measured against the server running on this machine:
 *
 * - `GET /v1/models` returns `{ id, object, owned_by }` and nothing else. The
 *   OpenAI shape has no field for it, so there is nothing to read.
 * - `GET /api/v0/models` — LM Studio's own REST surface, on the same port —
 *   returns `state`, `max_context_length` and `loaded_context_length`. For
 *   `qwen/qwen3.5-9b` that is 262144 and 64256: the model can take far more
 *   than the 8192 the app assumes, and the number that matters is the second
 *   one, because it is whatever was chosen when the model was loaded rather
 *   than what the weights allow.
 *
 * The difference is not academic. At an assumed 8192, a fixed overhead of
 * twelve thousand tokens leaves a negative budget, so a conversation trimmed to
 * fit would be trimmed to nothing. At the real 64256 it leaves room for a long
 * one.
 *
 * Everything here is pure except {@link readContextWindow}, so the parsing can
 * be tested against recorded payloads rather than against a running server.
 */

/** What LM Studio reports per model. Every field optional: this is another program's JSON. */
type LmStudioModel = {
  id?: unknown;
  state?: unknown;
  max_context_length?: unknown;
  loaded_context_length?: unknown;
};

/**
 * The address of LM Studio's own model list, from the OpenAI-compatible one.
 *
 * The two live on the same server under different prefixes, so this swaps the
 * prefix rather than asking anybody to configure a second endpoint. An address
 * that is not the OpenAI shape is left alone and simply will not answer, which
 * is the same outcome as not asking.
 */
export const lmStudioModelsUrl = (endpoint: string): string => {
  const trimmed = endpoint.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? `${trimmed.slice(0, -3)}/api/v0/models` : `${trimmed}/api/v0/models`;
};

const asPositiveInteger = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;

/**
 * The window the named model is loaded with, from a model list.
 *
 * `loaded_context_length` first and `max_context_length` never: the second is
 * what the weights support, and using it would promise room the server has not
 * allocated — the overflow this is all meant to avoid, arrived at from the
 * other direction.
 *
 * A model that is not loaded has no window to report, so it is skipped even if
 * its id matches.
 */
export const pickLoadedContext = (payload: unknown, modelId: string): number | null => {
  const data = (payload as { data?: unknown } | null)?.data;
  const models: LmStudioModel[] = Array.isArray(data) ? data : Array.isArray(payload) ? payload : [];
  if (models.length === 0) return null;

  const wanted = modelId.trim().toLowerCase();
  const named = models.find((model) => typeof model.id === 'string' && model.id.toLowerCase() === wanted);
  if (!named) return null;
  if (named.state !== 'loaded') return null;

  return asPositiveInteger(named.loaded_context_length);
};

/**
 * Asks the local server, and answers `null` for every way that can fail.
 *
 * Null means "carry on with the documented assumption", never "assume nothing
 * fits". A server that does not speak this dialect, a request that times out
 * and a model nobody has loaded all arrive at the same place, because the
 * caller's behaviour is the same in all three.
 */
export const readContextWindow = async (
  endpoint: string,
  modelId: string,
  signal?: AbortSignal
): Promise<number | null> => {
  if (modelId.trim().length === 0) return null;

  try {
    const response = await fetch(lmStudioModelsUrl(endpoint), {
      signal: signal ?? AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    return pickLoadedContext(await response.json(), modelId);
  } catch {
    return null;
  }
};
