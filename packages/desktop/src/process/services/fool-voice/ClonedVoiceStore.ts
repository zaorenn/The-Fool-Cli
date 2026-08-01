/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CLONING_ENGINES, type VoiceProfile } from '../../../common/types/foolVoice';

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

export type ClonedVoice = {
  id: string;
  displayName: string;
  languages: readonly string[];
  /**
   * What is said in the recording, word for word.
   *
   * Empty when the user did not supply one, which is the normal case now: of
   * the engines a clone is offered to, none reads it. Kept on the record rather
   * than dropped, because it costs nothing and an engine that aligns against
   * the clip's text can still be added later without re-recording every voice.
   */
  referenceText: string;
  referenceWavPath: string;
};

export const clonedProfileId = (voiceId: string): string => `${CLONED_PROFILE_PREFIX}${voiceId}`;

/**
 * What a voice id may look like once it becomes a directory name under
 * {@link ClonedVoiceStore.root}. The whole point of the check: this string
 * reaches the filesystem, so `..` or a path separator in it would let a
 * caller write outside the cloned-voices directory entirely.
 */
const VOICE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export const isValidVoiceId = (voiceId: string): boolean => VOICE_ID_PATTERN.test(voiceId);

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
    // A missing transcript no longer discards the voice. It used to, because the
    // only engine that could clone was ZipVoice, which aligns the new text
    // against what the clip says. Pocket, Chatterbox and IndexTTS2 build a
    // speaker embedding from the audio alone and never look at it — so a clip
    // with no transcript is a perfectly good voice to three of the four engines,
    // and throwing it away made an optional field silently mandatory.
    const referenceText = typeof manifest.referenceText === 'string' ? manifest.referenceText.trim() : '';

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
   * Writes a voice cloned from a recording the user just supplied — the same
   * two files a manual `%APPDATA%` copy would have produced, so nothing
   * downstream (the catalog, the picker, `synthesize`) needs to know this
   * voice arrived through the UI rather than by hand.
   *
   * Re-saving an id that already exists overwrites it in place: that is how a
   * user re-records a voice they were not happy with, and there is no
   * separate "update" entry point to keep in step with this one.
   */
  public save(
    voiceId: string,
    displayName: string,
    languages: readonly string[],
    referenceText: string,
    wav: Buffer
  ): void {
    if (!isValidVoiceId(voiceId)) {
      throw new Error(`invalid cloned voice id: ${voiceId}`);
    }
    const directory = path.join(this.root, voiceId);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'reference.wav'), wav);
    writeFileSync(
      path.join(directory, 'voice.json'),
      JSON.stringify({ id: voiceId, displayName, languages, referenceText }, null, 2)
    );
  }

  /**
   * Removes a voice's recording and manifest.
   *
   * A voice id that never existed is not an error: the caller asked for an
   * end state ("this voice is gone"), and that state already holds.
   */
  public delete(voiceId: string): void {
    if (!isValidVoiceId(voiceId)) {
      throw new Error(`invalid cloned voice id: ${voiceId}`);
    }
    const directory = path.join(this.root, voiceId);
    rmSync(directory, { recursive: true, force: true });
  }

  /**
   * The cloned voices as catalog profiles.
   *
   * Offered against every engine that can clone, because the reference belongs
   * to the user rather than to a model: the same recording is the same voice
   * whichever engine renders it. That is why a profile carries its engine's
   * provider id as well as its model id — the same clip appears once per engine
   * under one profile id, and only the pair says which one will speak.
   */
  public profiles(): VoiceProfile[] {
    return this.list().flatMap((voice) =>
      CLONING_ENGINES.map(
        (engine): VoiceProfile => ({
          id: clonedProfileId(voice.id),
          providerId: engine.providerId,
          modelId: engine.modelId,
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
