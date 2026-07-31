/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CLONING_MODEL_ID, type VoiceProfile } from '../../../common/types/foolVoice';

/**
 * Voices cloned from a recording the user supplied.
 *
 * Cloning in sherpa is not a training step that produces a model — it is a
 * reference clip and its transcript, handed to the engine with every request.
 * So a cloned voice is exactly those two things on disk, and this is what turns
 * a directory of them into profiles the rest of the app can select.
 *
 * One directory per voice, holding `reference.wav` and `voice.json`. A folder
 * that is missing either is skipped rather than surfaced as a voice that would
 * fail the moment it was chosen.
 */

/** Profile ids carry this prefix so the engine knows to look for a reference. */
export const CLONED_PROFILE_PREFIX = 'cloned:';

/**
 * Engines that can speak in a voice they were not trained on.
 *
 * Pocket only. It clones from the recording alone — no transcript to get wrong —
 * and keeps the speaker embedding between requests rather than deriving it from
 * the clip every sentence, which is what made it the faster of the two on a
 * machine with no GPU. Every machine this runs on has no GPU.
 *
 * Offering both put the same recording on the screen twice, once under each
 * engine, and a cloned voice carries one id whichever engine renders it — so
 * neither card could say which of the two would actually speak.
 */
const CLONING_MODEL_IDS = [CLONING_MODEL_ID];

export type ClonedVoice = {
  id: string;
  displayName: string;
  languages: readonly string[];
  /** What is said in the recording, word for word. */
  referenceText: string;
  referenceWavPath: string;
};

export const clonedProfileId = (voiceId: string): string => `${CLONED_PROFILE_PREFIX}${voiceId}`;

export const parseClonedProfileId = (profileId: string): string | null =>
  profileId.startsWith(CLONED_PROFILE_PREFIX) ? profileId.slice(CLONED_PROFILE_PREFIX.length) : null;

const readVoice = (root: string, id: string): ClonedVoice | null => {
  const directory = path.join(root, id);
  const referenceWavPath = path.join(directory, 'reference.wav');
  const manifestPath = path.join(directory, 'voice.json');
  if (!existsSync(referenceWavPath) || !existsSync(manifestPath)) return null;

  try {
    // These files get hand-edited, and a Windows editor saving "UTF-8" writes a
    // byte order mark that `JSON.parse` refuses. Dropping one silently loses the
    // voice, which is a baffling way for a recording to stop working.
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8').replace(/^﻿/, '')) as Partial<ClonedVoice>;
    const referenceText = typeof manifest.referenceText === 'string' ? manifest.referenceText.trim() : '';
    // Without the transcript the engine has nothing to align the clip against,
    // and the result is noise rather than a voice.
    if (referenceText.length === 0) return null;

    return {
      id,
      displayName: typeof manifest.displayName === 'string' && manifest.displayName ? manifest.displayName : id,
      languages: Array.isArray(manifest.languages) && manifest.languages.length > 0 ? manifest.languages : ['en'],
      referenceText,
      referenceWavPath,
    };
  } catch {
    // A hand-edited manifest with a trailing comma should cost one voice, not
    // the whole list.
    return null;
  }
};

export class ClonedVoiceStore {
  constructor(private root: string) {}

  public list(): ClonedVoice[] {
    if (!existsSync(this.root)) return [];

    try {
      return readdirSync(this.root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => readVoice(this.root, entry.name))
        .filter((voice): voice is ClonedVoice => voice !== null);
    } catch {
      return [];
    }
  }

  public find(voiceId: string): ClonedVoice | null {
    return readVoice(this.root, voiceId);
  }

  /**
   * The cloned voices as catalog profiles.
   *
   * Offered against every engine that can clone, because the reference belongs
   * to the user rather than to a model: the same recording is the same voice
   * whichever engine renders it.
   */
  public profiles(): VoiceProfile[] {
    return this.list().flatMap((voice) =>
      CLONING_MODEL_IDS.map(
        (modelId): VoiceProfile => ({
          id: clonedProfileId(voice.id),
          providerId: 'local-sherpa',
          modelId,
          kind: 'cloned',
          state: 'ready',
          displayName: voice.displayName,
          languages: voice.languages,
          deletable: true,
        })
      )
    );
  }
}
