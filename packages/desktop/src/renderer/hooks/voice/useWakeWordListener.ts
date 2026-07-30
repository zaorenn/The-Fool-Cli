/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { ipcBridge } from '@/common';
import { systemSettings } from '@/common/adapter/ipcBridge';
import { configService } from '@/common/config/configService';
import { reconcileVoiceModels } from '@renderer/services/voice/reconcileVoiceModels';
import {
  isManualVoiceSessionActive,
  subscribeManualVoiceSession,
  useFoolVoiceSession,
} from '@renderer/hooks/voice/useFoolVoiceSession';
import { useFoolVoiceSettings } from '@renderer/hooks/voice/useFoolVoiceSettings';

export type WakeListenerState = 'off' | 'listening' | 'awake';

/** Why the listener is not holding the microphone, for support and tests. */
export type WakeListenerReason = 'pet-off' | 'phrase-off' | 'talking' | 'model-missing' | 'no-microphone' | 'listening';

let wakeState: WakeListenerState = 'off';
const wakeListeners = new Set<(state: WakeListenerState) => void>();

const setWakeState = (next: WakeListenerState): void => {
  if (wakeState === next) return;
  wakeState = next;
  // Mirrored onto the document so an always-open microphone is never invisible:
  // anything in the app — or a test — can see that it is armed.
  if (typeof document !== 'undefined') document.body.dataset.foolWake = next;
  for (const listener of Array.from(wakeListeners)) listener(next);
};

const setWakeReason = (reason: WakeListenerReason): void => {
  if (typeof document !== 'undefined') document.body.dataset.foolWakeReason = reason;
};

export const peekWakeListenerState = (): WakeListenerState => wakeState;

export const subscribeWakeListener = (listener: (state: WakeListenerState) => void): (() => void) => {
  wakeListeners.add(listener);
  return () => {
    wakeListeners.delete(listener);
  };
};

/**
 * Always-on wake-word listening, tied to the desktop pet.
 *
 * The pet being up is the switch: while it is on screen the microphone stays
 * open and every utterance is checked for the wake phrase, so a conversation can
 * start without touching the keyboard. Turning the pet off closes capture, which
 * keeps "the pet is listening" and "the microphone is live" the same statement.
 *
 * Mounted once by the app root; it renders nothing.
 */
export const useWakeWordListener = (): void => {
  const { settings, ready, update } = useFoolVoiceSettings();
  const session = useFoolVoiceSession(settings);
  const [petEnabled, setPetEnabled] = useState(false);
  const [manualActive, setManualActive] = useState(isManualVoiceSessionActive);

  // The session object is rebuilt on every render; hold it in a ref so the effect
  // below reacts to the settings that matter, not to render timing.
  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => {
    let active = true;

    void systemSettings.getPetEnabled
      .invoke()
      .then((enabled) => {
        if (active) setPetEnabled(Boolean(enabled));
      })
      .catch(() => {
        // No pet, no listening: the safe default.
        if (active) setPetEnabled(false);
      });

    // Pet settings mirror the toggle locally as soon as it is switched.
    const unsubscribe = configService.subscribe('pet.enabled', (value) => setPetEnabled(Boolean(value)));

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => subscribeManualVoiceSession(setManualActive), []);

  // Before listening, make sure the configured recogniser is one that exists on
  // this machine — otherwise the wake word waits for a model nobody installed
  // while an installed one sits unused. Runs once per launch.
  const reconciled = useRef(false);
  useEffect(() => {
    if (!ready || reconciled.current || !petEnabled) return;
    reconciled.current = true;

    void ipcBridge.foolVoice.catalog
      .invoke({ version: 1, requestId: `wake-${crypto.randomUUID()}`, payload: { includeProfiles: false } })
      .then((response) => {
        if (response.ok === false) return;
        const next = reconcileVoiceModels(settings, response.data.models);
        if (next) update(() => next);
      })
      .catch(() => {
        // Without a catalog there is nothing to reconcile against; the listener
        // will simply report the missing model.
      });
  }, [petEnabled, ready, settings, update]);

  const shouldListen = ready && petEnabled && settings.activation.wakePhrase.enabled && !manualActive;

  useEffect(() => {
    if (!shouldListen) {
      sessionRef.current.stop();
      setWakeState('off');
      setWakeReason(!petEnabled ? 'pet-off' : manualActive ? 'talking' : 'phrase-off');
      return;
    }

    void sessionRef.current
      .startWakeListening()
      .then(() => {
        // `startWakeListening` resolves without opening capture when a model is
        // missing; the session reports which one.
        if (sessionRef.current.missingModelId) {
          setWakeState('off');
          setWakeReason('model-missing');
          return;
        }
        setWakeState('listening');
        setWakeReason('listening');
      })
      .catch(() => {
        // A refused microphone leaves the listener idle rather than raising an
        // error over the whole app.
        setWakeState('off');
        setWakeReason('no-microphone');
      });

    return () => {
      sessionRef.current.stop();
      setWakeState('off');
    };
    // Restarted when the device, the phrase or the recogniser changes, because
    // capture holds the callback that was registered when it opened.
  }, [
    shouldListen,
    settings.activation.wakePhrase.phrase,
    settings.devices.inputDeviceId,
    settings.stt.modelId,
    settings.vad.silenceMs,
  ]);

  // A missing model means `startWakeListening` returned without opening capture;
  // reflect that rather than claiming to listen.
  useEffect(() => {
    if (!shouldListen) return;
    if (session.missingModelId) {
      setWakeState('off');
      setWakeReason('model-missing');
      return;
    }
    if (session.state.phase !== 'idle') {
      setWakeState(session.state.phase === 'wake-listening' ? 'listening' : 'awake');
      setWakeReason('listening');
    }
  }, [session.missingModelId, session.state.phase, shouldListen]);
};
