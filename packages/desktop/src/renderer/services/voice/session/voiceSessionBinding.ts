/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { configService } from '@/common/config/configService';

/**
 * Which chat a spoken turn belongs to.
 *
 * Talking to the pet is one continuing conversation, not a thread per sentence.
 * The first wake creates a chat and every wake after it goes back to that same
 * chat — across restarts, because the binding is persisted. "New session from
 * next wake" in the pet's menu is the only thing that starts another one.
 */

const KEY = 'voice.boundConversationId';

/** Set by the pet menu; consumed by the next spoken turn. */
let newSessionRequested = false;

export const boundConversationId = (): string | null => {
  const stored = configService.get(KEY);
  return typeof stored === 'string' && stored.length > 0 ? stored : null;
};

export const bindConversation = (conversationId: string): void => {
  newSessionRequested = false;
  void configService.set(KEY, conversationId).catch((): void => {
    // A failed write costs the binding on the next launch, nothing more.
  });
};

export const clearBoundConversation = (): void => {
  void configService.set(KEY, undefined).catch((): void => undefined);
};

export const requestNewSession = (): void => {
  newSessionRequested = true;
  clearBoundConversation();
};

/** True when the user asked for a fresh chat and it has not been created yet. */
export const isNewSessionRequested = (): boolean => newSessionRequested;

/**
 * Whether the next turn should open a new chat.
 *
 * True when the user asked for one, and also when there is nothing bound yet —
 * the first thing ever said has to land somewhere.
 */
export const shouldStartNewSession = (): boolean => newSessionRequested || boundConversationId() === null;

/**
 * The bound chat, if it is still a real chat.
 *
 * A conversation the user has since deleted would otherwise take every spoken
 * turn to a dead route and leave the pet apparently ignoring them. Checking costs
 * one request against the local backend and turns that into a fresh chat instead.
 * An unreachable backend keeps the binding: an offline moment is not a reason to
 * abandon the conversation.
 */
export const resolveBoundConversation = async (): Promise<string | null> => {
  if (newSessionRequested) return null;

  const bound = boundConversationId();
  if (!bound) return null;

  try {
    const conversation = await ipcBridge.conversation.get.invoke({ id: bound });
    if (conversation?.id) return bound;
  } catch {
    return bound;
  }

  clearBoundConversation();
  return null;
};

/** Testing seam. */
export const resetVoiceSessionBinding = (): void => {
  newSessionRequested = false;
};
