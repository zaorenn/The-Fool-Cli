/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { conversationRuntime, type ConversationSnapshot } from './conversationRuntime';

/**
 * The page's view of the conversation.
 *
 * Almost nothing: the conversation itself lives in a module-level object so that
 * it survives the page being unmounted, and this subscribes to it. The only
 * thing the hook adds is lending the runtime the translations, which it cannot
 * get for itself from outside the component tree.
 *
 * `level` is deliberately not part of the snapshot. It changes many times a
 * second, and a re-render per audio block would cost more than everything else
 * on the page put together — the meter reads the box directly inside its own
 * animation frame.
 */

export type ConversationHandle = ConversationSnapshot & {
  level: { current: number };
  start: () => Promise<void>;
  stop: () => void;
  interrupt: () => void;
  setError: (message: string) => void;
};

export const useConversation = (): ConversationHandle => {
  const { t, i18n } = useTranslation();

  // During render rather than in an effect: a conversation can be started from
  // the first commit, and a runtime without translations would name its own
  // activities with i18n keys.
  conversationRuntime.attach(t as never, i18n.language);

  const snapshot = useSyncExternalStore(conversationRuntime.subscribe, conversationRuntime.getSnapshot);

  return {
    ...snapshot,
    level: conversationRuntime.level,
    start: conversationRuntime.start,
    stop: conversationRuntime.stop,
    interrupt: conversationRuntime.interrupt,
    setError: conversationRuntime.setError,
  };
};
