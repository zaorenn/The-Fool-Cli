/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import { ipcBridge } from '@/common';
import {
  VOICE_HOME_SUBMIT_EVENT,
  VOICE_SUBMIT_EVENT,
  VOICE_TURN_EVENT,
  type VoiceSubmitDetail,
} from '@renderer/services/voice/voiceEvents';
import {
  bindConversation,
  boundConversationId,
  requestNewSession,
  shouldStartNewSession,
} from '@renderer/services/voice/voiceSessionBinding';

/**
 * Decides where a spoken turn goes.
 *
 * The voice loop knows what was said; it should not have to know about routes.
 * This hook is the one place that turns "the user said something" into "this chat
 * receives it": an existing binding is reused, otherwise the home composer opens
 * a new chat with whichever agent and model the user last chose — the same path
 * as typing there, so nothing about conversation creation is duplicated.
 *
 * Navigation goes through the location hash rather than through react-router.
 * This hook is mounted at the app root, which sits *outside* the router, and
 * calling `useNavigate` there throws — which took the whole renderer down to a
 * black screen. The app is hash-routed, so setting the hash is the same
 * navigation by a route the router cannot object to.
 */

/** Time allowed for the target surface to mount before the text is handed over. */
const HANDOVER_MS = 450;

const currentPath = (): string => {
  const hash = window.location.hash;
  return hash.startsWith('#') ? hash.slice(1) : hash;
};

const goTo = (path: string): void => {
  if (currentPath() === path) return;
  window.location.hash = `#${path}`;
};

export const useVoiceSessionRouter = (): void => {
  /** Set while a spoken turn is opening a new chat, so its id can be bound. */
  const awaitingNewConversation = useRef(false);

  useEffect(() => {
    const handleTurn = (event: Event) => {
      const { text } = (event as CustomEvent<VoiceSubmitDetail>).detail;
      if (!text.trim()) return;

      const bound = boundConversationId();
      const startFresh = shouldStartNewSession() || !bound;

      const target = startFresh ? '/guid' : `/conversation/${bound}`;
      const alreadyThere = currentPath() === target;
      const forward = startFresh ? VOICE_HOME_SUBMIT_EVENT : VOICE_SUBMIT_EVENT;

      awaitingNewConversation.current = startFresh;
      goTo(target);

      window.setTimeout(
        () => window.dispatchEvent(new CustomEvent<VoiceSubmitDetail>(forward, { detail: { text } })),
        alreadyThere ? 0 : HANDOVER_MS
      );
    };

    window.addEventListener(VOICE_TURN_EVENT, handleTurn);
    return () => window.removeEventListener(VOICE_TURN_EVENT, handleTurn);
  }, []);

  // The pet's menu asks for a fresh chat next time. The pet is a desktop window,
  // so the subscription is optional: in the browser build there is no menu.
  useEffect(() => {
    const emitter = ipcBridge.foolVoice?.newSessionOnNextWake;
    if (typeof emitter?.on !== 'function') return;
    return emitter.on(() => requestNewSession());
  }, []);

  // A spoken turn that opened a new chat lands on /conversation/<id>; that id is
  // what later turns should go to.
  useEffect(() => {
    const remember = () => {
      if (!awaitingNewConversation.current) return;
      const match = /^\/conversation\/([^/?]+)/.exec(currentPath());
      if (!match) return;
      awaitingNewConversation.current = false;
      bindConversation(match[1]);
    };

    window.addEventListener('hashchange', remember);
    return () => window.removeEventListener('hashchange', remember);
  }, []);
};
