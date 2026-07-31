/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Tooltip } from '@arco-design/web-react';
import { Microphone, Voice } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { VoicePcm16Wav } from '@/common/types/foolVoice';
import { useFoolVoiceSettings } from '@renderer/hooks/voice/useFoolVoiceSettings';
import { MicrophoneCapture } from '@renderer/services/voice/MicrophoneCapture';
import { publishDictationLevel } from '@renderer/services/voice/dictationLevel';

export type VoiceDictationButtonProps = {
  disabled?: boolean;
  /** Interim words while the button is held; `null` ends the live region. */
  onLiveTranscript: (text: string | null) => void;
  /** The finished sentence, appended to whatever was already typed. */
  onTranscript: (text: string) => void;
  /** Sends the composer, once the final transcript has been written into it. */
  onSubmit?: () => void;
  /** Opens the Voice settings install flow when the speech model is missing. */
  onRequestModelInstall?: (modelId: string) => void;
};

/**
 * Hold to talk, release to send.
 *
 * The composer's microphone used to start the hands-free loop, which announces
 * itself to the pet and the caption strip — so pressing a button in the window
 * you are looking at threw a second window over your screen. Dictation is the
 * thing a composer actually wants: it belongs to this text box, it ends when the
 * button comes up, and it never leaves this window.
 *
 * The words appear while they are being said. Sherpa transcription is one-shot
 * rather than streaming, so what arrives is the whole utterance so far,
 * re-transcribed every second or so and written into the composer's live region.
 * It is not word-by-word streaming and it does not pretend to be; it is close
 * enough to watch a sentence assemble itself.
 */

/** How often the held button re-transcribes what has been said so far. */
const INTERIM_MS = 1100;

/**
 * Loudness scaling for the waveform beside the button.
 *
 * The same factor the hands-free loop uses, so a voice draws the same height
 * whichever microphone is open.
 */
const LEVEL_SCALE = 4;

const newOperationId = () => `dictate-${crypto.randomUUID()}`;

const unwrap = <T,>(envelope: { ok: true; data: T } | { ok: false; error: { code: string } }): T => {
  if (envelope.ok === false) throw new Error(envelope.error.code);
  return envelope.data;
};

const VoiceDictationButton: React.FC<VoiceDictationButtonProps> = ({
  disabled,
  onLiveTranscript,
  onTranscript,
  onSubmit,
  onRequestModelInstall,
}) => {
  const { t } = useTranslation();
  const { settings } = useFoolVoiceSettings();
  const [state, setState] = useState<'idle' | 'opening' | 'holding' | 'finishing'>('idle');

  const capture = useRef<MicrophoneCapture | null>(null);
  const interim = useRef<number | null>(null);
  /** True while an interim request is in flight, so they cannot pile up. */
  const transcribing = useRef(false);
  /** Guards against a release that lands before the microphone finished opening. */
  const held = useRef(false);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const onLiveTranscriptRef = useRef(onLiveTranscript);
  onLiveTranscriptRef.current = onLiveTranscript;

  const transcribe = useCallback(async (audio: VoicePcm16Wav): Promise<string> => {
    const operationId = newOperationId();
    const stt = settingsRef.current.stt;
    const result = unwrap(
      await ipcBridge.foolVoice.transcribe.invoke({
        version: 1,
        requestId: operationId,
        payload: { operationId, providerId: stt.providerId, modelId: stt.modelId, languageHint: stt.language, audio },
      })
    );
    return result.text.trim();
  }, []);

  const closeMicrophone = useCallback(() => {
    if (interim.current !== null) {
      window.clearInterval(interim.current);
      interim.current = null;
    }
    capture.current?.stop();
    capture.current = null;
    publishDictationLevel(null);
  }, []);

  // A button unmounted mid-hold — the page navigating away as the turn is sent —
  // must not leave the microphone open behind it.
  useEffect(() => closeMicrophone, [closeMicrophone]);

  const begin = useCallback(async () => {
    if (capture.current) return;

    const modelId = settingsRef.current.stt.modelId;
    const health = unwrap(
      await ipcBridge.foolVoice.health.invoke({
        version: 1,
        requestId: newOperationId(),
        payload: { providerId: 'local-sherpa', modelId },
      })
    );
    // Never a dead control: with no speech model installed, say which one and
    // offer to fetch it rather than opening a microphone that cannot be read.
    if (health.status !== 'ready') {
      onRequestModelInstall?.(modelId);
      return;
    }

    const microphone = new MicrophoneCapture();
    await microphone.start(settingsRef.current.devices.inputDeviceId);
    // Released before the device finished opening: close it again rather than
    // leaving a microphone live under a button that is no longer down.
    if (!held.current) {
      microphone.stop();
      return;
    }

    capture.current = microphone;
    microphone.onFrame(({ rms }) => publishDictationLevel(Math.min(1, rms * LEVEL_SCALE)));
    microphone.beginUtterance();
    publishDictationLevel(0);

    interim.current = window.setInterval(() => {
      if (transcribing.current || !capture.current) return;
      const audio = capture.current.peekUtteranceWav();
      if (!audio) return;

      transcribing.current = true;
      void transcribe(audio)
        .then((text) => {
          // The button may have come up while this was in flight; the final
          // transcript owns the composer from that point on.
          if (capture.current && text.length > 0) onLiveTranscriptRef.current(text);
        })
        .catch((): void => {
          // An interim that fails costs nothing: the next one is a second away,
          // and the release transcribes the whole utterance regardless.
        })
        .finally(() => {
          transcribing.current = false;
        });
    }, INTERIM_MS);
  }, [onRequestModelInstall, transcribe]);

  const finish = useCallback(async () => {
    const microphone = capture.current;
    if (!microphone) return;

    const audio = microphone.takeUtteranceWav();
    closeMicrophone();

    // Whatever the interims wrote is scaffolding; the composer goes back to what
    // the user had typed before the final sentence is appended to it.
    onLiveTranscriptRef.current(null);
    if (!audio) return;

    const text = await transcribe(audio);
    if (text.length === 0) return;

    onTranscript(text);
    // Let the controlled input commit the transcript before the send handler
    // reads it — the same handover the wake word uses.
    if (onSubmit) window.setTimeout(onSubmit, 0);
  }, [closeMicrophone, onSubmit, onTranscript, transcribe]);

  const handlePointerDown = useCallback(() => {
    if (disabled || held.current) return;
    held.current = true;
    setState('opening');

    void begin()
      .then(() => setState(held.current && capture.current ? 'holding' : 'idle'))
      .catch(() => {
        // A refused microphone leaves the button idle rather than raising an
        // error over the composer.
        held.current = false;
        closeMicrophone();
        setState('idle');
      });
  }, [begin, closeMicrophone, disabled]);

  const handlePointerUp = useCallback(() => {
    if (!held.current) return;
    held.current = false;
    setState('finishing');

    void finish()
      .catch((): void => {
        // A failed transcription leaves the composer as the user left it.
        onLiveTranscriptRef.current(null);
      })
      .finally(() => setState('idle'));
  }, [finish]);

  const listening = state === 'holding' || state === 'opening';
  const label = listening ? t('conversation.chat.voice.dictateRelease') : t('conversation.chat.voice.dictateHold');

  return (
    <Tooltip content={label} mini>
      <Button
        type='text'
        size='small'
        shape='circle'
        aria-label={label}
        data-testid='voice-dictate'
        data-holding={listening ? 'true' : undefined}
        disabled={disabled}
        loading={state === 'finishing'}
        onMouseDown={handlePointerDown}
        onMouseUp={handlePointerUp}
        // Sliding off the button still ends the sentence: a held pointer that
        // leaves never sends a mouseup here, and the microphone would stay open.
        onMouseLeave={handlePointerUp}
        onTouchStart={handlePointerDown}
        onTouchEnd={handlePointerUp}
        onTouchCancel={handlePointerUp}
        className={listening ? 'text-primary' : undefined}
        icon={listening ? <Voice theme='filled' size={18} /> : <Microphone theme='outline' size={18} />}
      />
    </Tooltip>
  );
};

export default VoiceDictationButton;
