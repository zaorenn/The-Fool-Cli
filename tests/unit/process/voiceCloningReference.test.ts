/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { getEngineSpec, isCloningTts } from '@process/services/fool-voice/voiceEngineSpecs';
import { SherpaVoiceProvider } from '@process/services/fool-voice/SherpaVoiceProvider';
import { VoiceModelCatalog } from '@process/services/fool-voice/VoiceModelCatalog';

/**
 * Pressing "check" on a cloning model used to kill the application.
 *
 * These engines have no voice of their own — no speaker table to index into.
 * The voice arrives with the request as a recording and its transcript. Handed
 * none, the addon does not return an error; it dies, and a native crash takes
 * every window down with it.
 *
 * Verification is exactly how a user meets that: it runs the model with no
 * profile chosen, and a cloning model lists no profiles to choose from.
 */
describe('synthesising with a cloning engine', () => {
  const cloningModelIds = VoiceModelCatalog.getModels()
    .filter((model) => model.role === 'text-to-speech')
    .map((model) => model.id)
    .filter((id) => {
      const spec = getEngineSpec(id);
      return spec?.role === 'text-to-speech' && isCloningTts(spec.engine.kind);
    });

  it('recognises the engines that cannot speak unaided', () => {
    expect(isCloningTts('zipvoice')).toBe(true);
    expect(isCloningTts('pocket')).toBe(true);
    for (const kind of ['vits', 'kokoro', 'kitten', 'matcha'] as const) {
      expect(isCloningTts(kind)).toBe(false);
    }
  });

  it('finds the cloning models the catalog offers', () => {
    // If this ever empties the tests below stop proving anything.
    expect(cloningModelIds.length).toBeGreaterThan(0);
  });

  it('leaves a cloning model with no voice to borrow, which is what made the crash reachable', () => {
    for (const id of cloningModelIds) {
      const model = VoiceModelCatalog.getModels().find((candidate) => candidate.id === id);
      expect(model?.profileIds).toEqual([]);
    }
  });

  it('refuses the request instead of handing the engine no reference', async () => {
    const provider = new SherpaVoiceProvider();

    for (const id of cloningModelIds) {
      // `verify` is the real caller: no profile chosen, so no reference is found.
      await expect(provider.synthesize(id, 'verify', 'en', 1, 'The fool is ready.')).rejects.toThrow(
        /needs a reference recording/
      );
    }
  });
});
