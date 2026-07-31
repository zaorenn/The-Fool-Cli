/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { FoolVoiceSettings, VoiceSynthesizedWav } from '@/common/types/foolVoice';
import type { AudioPlaybackService } from '@renderer/services/voice/AudioPlaybackService';
import { summarizeForSpeech } from '@renderer/services/voice/narration/englishSummary';
import { splitForSpeech } from '@renderer/services/voice/narration/speechChunks';
import { selectTtsTarget } from '@renderer/services/voice/selectTtsTarget';

/**
 * Reading one passage aloud, wherever the request came from.
 *
 * There used to be two of these — the read-aloud button's and the voice
 * session's — which is how they came to disagree about which voice to use and
 * about what to do when the chosen one is missing. One routine means the button
 * and the automatic reading cannot drift apart, and a voice the user selected
 * and then deleted falls back the same way for both.
 *
 * The passage is spoken as a run of clips rather than one: the first is short,
 * and each is rendered while the one before it plays. Offline synthesis means
 * nothing is heard until rendering finishes, so asking for the whole answer at
 * once makes the wait the length of the answer — which is why the cloning voice,
 * the slowest of them, felt slowest of all on exactly the long replies it was
 * wanted for.
 */

export type SpeakOutcome =
  | { spoken: true }
  /** Nothing worth saying was left after sanitising. */
  | { spoken: false; reason: 'empty' }
  /** No text-to-speech model is installed, so there is nothing to speak with. */
  | { spoken: false; reason: 'no-voice' };

const newRequestId = () => `speak-${crypto.randomUUID()}`;

const unwrap = <T>(envelope: { ok: true; data: T } | { ok: false; error: { code: string } }): T => {
  if (envelope.ok === false) throw new Error(envelope.error.code);
  return envelope.data;
};

export type SpeakTextRequest = {
  text: string;
  settings: FoolVoiceSettings;
  playback: AudioPlaybackService;
  maxSpokenCharacters: number;
  /** Records the operation id, so a caller can cancel a synthesis in flight. */
  onOperation?: (operationId: string) => void;
  /** Called once, when the first clip is about to play. */
  onPlaybackStart?: () => void;
  /**
   * Called before every clip, the first one included.
   *
   * The passage is spoken as several clips, and anything timed from "the voice
   * started" — the window in which its own echo must not be mistaken for the
   * user interrupting — has to be measured from each of them, not just the first.
   */
  onClipStart?: () => void;
  /**
   * Asked before each clip; a false answer abandons the rest of the passage.
   *
   * For a caller whose reason to stop is its own rather than the player's. The
   * voice session's is that it may be closed while the summary is still being
   * written — a model load takes long enough for the user to have given up on
   * the whole conversation — and speaking after that talks over a microphone
   * that is already shut.
   */
  shouldContinue?: () => boolean;
};

export const speakText = async (request: SpeakTextRequest): Promise<SpeakOutcome> => {
  const { settings } = request;
  // Sanitised and, unless the reply itself is what should be heard, translated
  // and shortened first.
  const { text: spoken } = await summarizeForSpeech(request.text, settings, request.maxSpokenCharacters);
  if (spoken.length === 0) return { spoken: false, reason: 'empty' };

  const catalog = unwrap(
    await ipcBridge.foolVoice.catalog.invoke({
      version: 1,
      requestId: newRequestId(),
      payload: { includeProfiles: false },
    })
  );
  const installed = catalog.models
    .filter((model) => model.role === 'text-to-speech' && model.state.status === 'ready')
    .map((model) => model.id);
  if (installed.length === 0) return { spoken: false, reason: 'no-voice' };

  const target = selectTtsTarget(spoken, settings, installed);
  // Fall back to something installed rather than failing on a voice the user
  // selected and then removed.
  const modelId = installed.includes(target.modelId) ? target.modelId : installed[0];
  const profileId = modelId === target.modelId ? target.profileId : 'speaker-0';

  const synthesize = (text: string): Promise<VoiceSynthesizedWav> => {
    const operationId = newRequestId();
    request.onOperation?.(operationId);
    const audio = ipcBridge.foolVoice.synthesize
      .invoke({
        version: 1,
        requestId: operationId,
        payload: {
          operationId,
          providerId: settings.tts.providerId,
          modelId,
          profileId,
          language: target.language,
          speed: settings.tts.speed,
          text,
        },
      })
      .then((envelope) => unwrap(envelope).audio);
    // A clip that is rendered but never reached — the user interrupted, or an
    // earlier clip failed — must not surface as an unhandled rejection. The
    // promise still rejects for whoever awaits it; this only says someone is
    // always listening.
    audio.catch((): void => undefined);
    return audio;
  };

  const { playback } = request;
  // Checked before the player is claimed as well as before each clip: the
  // summary above can take a model load, and a caller may have given up during it.
  if (request.shouldContinue?.() === false) return { spoken: true };

  playback.setOutputDevice(settings.devices.outputDeviceId);
  // Whatever was being said gives way to this, and the token taken straight
  // afterwards is what the rest of this passage speaks under: a stop from
  // anywhere — barge-in, the button, an unmount — invalidates it and the clips
  // still queued behind it are dropped rather than spoken over the silence the
  // user just asked for.
  playback.stop();
  const sequence = playback.currentGeneration();

  const chunks = splitForSpeech(spoken);
  // Rendering of the next clip is started before the current one plays, so the
  // engine works through the answer while the speakers are busy with it.
  let pending = synthesize(chunks[0]);

  for (let index = 0; index < chunks.length; index += 1) {
    const audio = await pending;
    if (!playback.isCurrent(sequence) || request.shouldContinue?.() === false) return { spoken: true };

    const next = chunks[index + 1];
    pending = next === undefined ? pending : synthesize(next);

    if (index === 0) request.onPlaybackStart?.();
    request.onClipStart?.();
    await playback.play(audio);
    if (!playback.isCurrent(sequence) || request.shouldContinue?.() === false) return { spoken: true };
  }

  return { spoken: true };
};
