/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { configService } from '@/common/config/configService';

/**
 * Which chat a spoken turn belongs to.
 *
 * Talking to the pet should feel like one continuing conversation, not a new
 * thread per sentence — so the first wake creates a chat and every later wake
 * goes back to it. The binding is persisted, so closing the app and coming back
 * to the same subject works; "New session from next wake" in the pet's menu is
 * how the user says they are done with it.
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

export const requestNewSession = (): void => {
  newSessionRequested = true;
  void configService.set(KEY, undefined).catch((): void => undefined);
};

/**
 * Whether the next turn should open a new chat.
 *
 * True when the user asked for one, and also when there is nothing bound yet —
 * the first thing ever said has to land somewhere.
 */
export const shouldStartNewSession = (): boolean => newSessionRequested || boundConversationId() === null;

/** Testing seam. */
export const resetVoiceSessionBinding = (): void => {
  newSessionRequested = false;
};
