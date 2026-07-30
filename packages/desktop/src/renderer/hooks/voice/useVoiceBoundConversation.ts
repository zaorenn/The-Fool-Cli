/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { configService } from '@/common/config/configService';
import {
  bindConversation,
  boundConversationId,
  clearBoundConversation,
} from '@renderer/services/voice/session/voiceSessionBinding';

export type VoiceBoundConversation = {
  /** The chat every spoken turn goes to, or null when none is set. */
  conversationId: string | null;
  /** True for the one chat that holds it. */
  isBound: (conversationId: string) => boolean;
  /** Sets this chat, releasing whichever held it before. */
  bind: (conversationId: string) => void;
  release: () => void;
  /** Sets it, or releases it when it is already this chat. */
  toggle: (conversationId: string) => void;
};

/**
 * Which chat the voice is talking to, for the surfaces that show and set it.
 *
 * Exactly one at a time, by construction: the binding is a single stored value,
 * so setting a chat releases whichever held it. Subscribed rather than read once,
 * because the wake word itself moves the binding when it opens a new chat and the
 * list has to follow.
 */
export const useVoiceBoundConversation = (): VoiceBoundConversation => {
  const [conversationId, setConversationId] = useState<string | null>(boundConversationId);

  useEffect(() => {
    const read = () => setConversationId(boundConversationId());
    read();
    return configService.subscribe('voice.boundConversationId', read);
  }, []);

  const bind = useCallback((next: string) => {
    bindConversation(next);
    setConversationId(next);
  }, []);

  const release = useCallback(() => {
    clearBoundConversation();
    setConversationId(null);
  }, []);

  const toggle = useCallback(
    (next: string) => {
      if (boundConversationId() === next) release();
      else bind(next);
    },
    [bind, release]
  );

  const isBound = useCallback((candidate: string) => conversationId === candidate, [conversationId]);

  return { conversationId, isBound, bind, release, toggle };
};
