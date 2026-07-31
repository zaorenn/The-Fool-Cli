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
import { createSpeechClipQueue } from '@renderer/services/voice/speechClipQueue';

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

/**
 * Matches `CLONED_PROFILE_PREFIX` in the main process's `ClonedVoiceStore`.
 * Not imported directly: that module lives under `process/`, off limits to
 * the renderer, and the prefix is part of the profile id's public shape
 * rather than an implementation detail of the store.
 */
const CLONED_PROFILE_PREFIX = 'cloned:';

export type PreparedSynthesis = { synthesize: (text: string) => Promise<VoiceSynthesizedWav> };

/** No text-to-speech model is installed to speak with. */
export type SynthesisUnavailable = { unavailable: true };

/**
 * Resolves which installed voice speaks a passage and returns a ready
 * `synthesize` function for it.
 *
 * This is the target/fallback resolution `speakText` always needed — catalog
 * lookup, language/Turkish-voice selection, and falling back to something
 * installed when the configured voice (or, for a cloned one, just its
 * recording) is missing — pulled out so a caller that renders clips as text
 * arrives (`useAutoReadAloud`) can reuse it instead of duplicating it.
 *
 * `sampleText` only informs which voice is picked (Turkish detection, same as
 * `selectTtsTarget` always used the full passage for); the `synthesize` it
 * returns can be called with different text on every clip.
 */
export const prepareSynthesis = async (
  sampleText: string,
  settings: FoolVoiceSettings,
  playback: AudioPlaybackService,
  onOperation?: (operationId: string) => void
): Promise<PreparedSynthesis | SynthesisUnavailable> => {
  const catalog = unwrap(
    await ipcBridge.foolVoice.catalog.invoke({
      version: 1,
      requestId: newRequestId(),
      payload: { includeProfiles: true },
    })
  );
  const installed = catalog.models
    .filter((model) => model.role === 'text-to-speech' && model.state.status === 'ready')
    .map((model) => model.id);
  if (installed.length === 0) return { unavailable: true };

  const target = selectTtsTarget(sampleText, settings, installed);

  // A cloned voice is a recording, not a trained model: its id names a real,
  // installed engine (Pocket) whichever machine runs it, so "the model is
  // installed" is true even when the recording itself was deleted, or was
  // never copied to this machine. That engine has no voice of its own to fall
  // back on — asked to speak with nothing to imitate, it used to crash the
  // whole app; now it refuses the request outright. Left uncaught here, that
  // refusal is what "speak aloud" reads as failing for a normal message that
  // never asked for cloning at all.
  const clonedReferenceMissing =
    target.profileId.startsWith(CLONED_PROFILE_PREFIX) &&
    !catalog.profiles.some((profile) => profile.id === target.profileId);

  // A model with no presets of its own is a cloning model — picking it as the
  // fallback would trade one "no reference" refusal for another. Preferred
  // over `installed[0]` for exactly the case that sent this whole request
  // down the fallback path: pocket, installed, sitting right next to a
  // perfectly good preset voice.
  const modelsWithOwnVoice = new Set(
    catalog.models
      .filter(
        (model) =>
          model.role === 'text-to-speech' && model.state.status === 'ready' && (model.profileIds?.length ?? 0) > 0
      )
      .map((model) => model.id)
  );
  const fallbackModelId = installed.find((id) => modelsWithOwnVoice.has(id)) ?? installed[0];

  // Fall back to something installed rather than failing on a voice the user
  // selected and then removed — whether the whole model is gone, or, for a
  // cloned one, just the recording it needs in order to speak at all. Kept as
  // its own flag rather than compared back from `modelId`: the fallback model
  // can coincide with the configured one (the only installed voice IS the
  // broken cloning model), and re-deriving "did we fall back" from that
  // equality would then wrongly say no.
  const useConfigured = installed.includes(target.modelId) && !clonedReferenceMissing;
  const modelId = useConfigured ? target.modelId : fallbackModelId;
  const profileId = useConfigured ? target.profileId : 'speaker-0';

  const synthesize = (text: string): Promise<VoiceSynthesizedWav> => {
    const operationId = newRequestId();
    onOperation?.(operationId);
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

  playback.setOutputDevice(settings.devices.outputDeviceId);
  // Whatever was being said gives way to this, and the token taken straight
  // afterwards is what the rest of this passage speaks under: a stop from
  // anywhere — barge-in, the button, an unmount — invalidates it and the clips
  // still queued behind it are dropped rather than spoken over the silence the
  // user just asked for.
  playback.stop();

  return { synthesize };
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

  // Checked before the player is claimed as well as before each clip: the
  // summary above can take a model load, and a caller may have given up during it.
  if (request.shouldContinue?.() === false) return { spoken: true };

  const { playback } = request;
  const prepared = await prepareSynthesis(spoken, settings, playback, request.onOperation);
  if ('unavailable' in prepared) return { spoken: false, reason: 'no-voice' };
  const { synthesize } = prepared;

  const chunks = splitForSpeech(spoken);
  const queue = createSpeechClipQueue(playback, synthesize, {
    onPlaybackStart: request.onPlaybackStart,
    onClipStart: request.onClipStart,
    shouldContinue: request.shouldContinue,
  });
  for (const chunk of chunks) queue.push(chunk);
  await queue.finish();

  return { spoken: true };
};
