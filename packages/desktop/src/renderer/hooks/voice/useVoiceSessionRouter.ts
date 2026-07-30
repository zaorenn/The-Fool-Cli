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
  requestNewSession,
  resolveBoundConversation,
} from '@renderer/services/voice/session/voiceSessionBinding';
import { startVoiceConversation } from '@renderer/services/voice/session/startVoiceConversation';
import { readVoiceSettings } from '@renderer/services/voice/voiceSettingsStore';

/**
 * Decides where a spoken turn goes.
 *
 * The voice loop knows what was said; it should not have to know about routes.
 * This hook is the one place that turns "the user said something" into "this chat
 * receives it".
 *
 * A first turn opens a chat on the agent and model pinned in Voice settings,
 * created directly so the turn does not depend on the home page being mounted and
 * painting — that page cannot be relied on with the window minimised, which is
 * the whole point of a wake word. With nothing pinned it falls back to the home
 * composer, which is where the older behaviour of inheriting the last-used agent
 * comes from.
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
    /** Hands the text to a surface that has to mount first. */
    const handOver = (name: string, detail: VoiceSubmitDetail, immediate: boolean): void => {
      window.setTimeout(
        () => window.dispatchEvent(new CustomEvent<VoiceSubmitDetail>(name, { detail })),
        immediate ? 0 : HANDOVER_MS
      );
    };

    const handleTurn = async (text: string): Promise<void> => {
      // Every wake continues the same chat. A new one only happens when the user
      // asked for it, or when the bound chat no longer exists.
      const bound = await resolveBoundConversation();

      if (!bound) {
        const settings = await readVoiceSettings();
        const started = await startVoiceConversation({ text, settings });
        if (started.ok) {
          // The conversation page picks the message up as it mounts, so there is
          // nothing to hand over and nothing to type.
          bindConversation(started.conversationId);
          awaitingNewConversation.current = false;
          goTo(`/conversation/${started.conversationId}`);
          return;
        }

        // Nothing pinned, or the pinned agent has gone: the home composer still
        // knows how to open a chat.
        awaitingNewConversation.current = true;
        const alreadyAtHome = currentPath() === '/guid';
        goTo('/guid');
        handOver(VOICE_HOME_SUBMIT_EVENT, { text }, alreadyAtHome);
        return;
      }

      const target = `/conversation/${bound}`;
      const alreadyThere = currentPath() === target;
      awaitingNewConversation.current = false;
      goTo(target);
      handOver(VOICE_SUBMIT_EVENT, { text }, alreadyThere);
    };

    const onTurn = (event: Event) => {
      const { text } = (event as CustomEvent<VoiceSubmitDetail>).detail;
      if (!text.trim()) return;
      void handleTurn(text).catch(() => {
        // A turn that cannot be routed is dropped rather than left half-sent; the
        // next thing said starts again from a clean state.
      });
    };

    window.addEventListener(VOICE_TURN_EVENT, onTurn);
    return () => window.removeEventListener(VOICE_TURN_EVENT, onTurn);
  }, []);

  // The pet's menu asks for a fresh chat next time. The pet is a desktop window,
  // so the subscription is optional: in the browser build there is no menu.
  useEffect(() => {
    const emitter = ipcBridge.foolVoice?.newSessionOnNextWake;
    if (typeof emitter?.on !== 'function') return;
    return emitter.on(() => requestNewSession());
  }, []);

  // A spoken turn that opened a new chat through the home composer lands on
  // /conversation/<id>; that id is what later turns should go to.
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
