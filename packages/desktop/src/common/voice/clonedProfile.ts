/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Marks a profile as a recording of somebody rather than a shipped preset.
 *
 * Part of the profile id's public shape rather than an implementation detail of
 * the store that writes it, which is why it lives here: the renderer has to tell
 * a cloned voice from a preset one, and the store it comes from is under
 * `process/`, off limits to the renderer.
 *
 * Matches `CLONED_PROFILE_PREFIX` in the main process's `ClonedVoiceStore`.
 */
export const CLONED_PROFILE_PREFIX = 'cloned:';
