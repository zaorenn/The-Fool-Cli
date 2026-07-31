/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which discovery tier produced a local model list.
 *
 * `complete` and `complete-degraded` both cover every installed model;
 * `loaded-only` covers just the models the host currently has loaded and must
 * be labelled as incomplete in the UI. `unavailable` means nothing answered.
 */
export type ModelListTier = 'complete' | 'complete-degraded' | 'loaded-only' | 'unavailable';

/** Discovery result as it crosses the process boundary. */
export type LocalModelListResult = {
  tier: ModelListTier;
  models: string[];
};
