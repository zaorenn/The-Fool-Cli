/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { ipcBridge } from '@/common';
import type { VoiceShortcutResponse } from '@/common/types/foolVoice';

export type PushToTalkState = VoiceShortcutResponse | null;

/**
 * Claims the desktop-wide shortcut and answers it.
 *
 * Pressed with the app behind everything else, this starts a spoken turn: a chime,
 * then listening, then the turn is transcribed and sent the moment the speaker
 * stops. Pressed again during the same turn it ends the utterance immediately,
 * which is the deliberate way to say "that's all" in a room quiet enough that the
 * detector is still waiting.
 *
 * It is not hold-to-talk. Electron's global shortcuts report the press and not the
 * release, so a key-up cannot be seen without a native keyboard hook — the
 * released-key behaviour is approximated by the same silence detection every other
 * spoken turn uses.
 */
export const usePushToTalkShortcut = (accelerator: string, onPress: () => void): PushToTalkState => {
  const [state, setState] = useState<PushToTalkState>(null);

  // Held in a ref so re-registration is driven by the accelerator changing and not
  // by the callback being rebuilt on every render.
  const pressRef = useRef(onPress);
  pressRef.current = onPress;

  useEffect(() => {
    const emitter = ipcBridge.foolVoice?.pushToTalk;
    if (typeof emitter?.on !== 'function') return;
    return emitter.on(() => pressRef.current());
  }, []);

  useEffect(() => {
    const claim = ipcBridge.foolVoice?.shortcut;
    if (typeof claim?.invoke !== 'function') return;

    let active = true;
    void claim
      .invoke({ version: 1, requestId: `shortcut-${crypto.randomUUID()}`, payload: { accelerator } })
      .then((response) => {
        if (!active) return;
        setState(response.ok ? response.data : { accelerator, registered: false, reason: 'unsupported' });
      })
      .catch(() => {
        if (active) setState({ accelerator, registered: false, reason: 'unsupported' });
      });

    return () => {
      active = false;
    };
  }, [accelerator]);

  return state;
};
