/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import type { VoiceMemory } from '@/common/voice/memory';
import {
  peekVoiceMemory,
  readVoiceMemory,
  subscribeVoiceMemory,
} from '@renderer/services/voice/session/voiceMemoryStore';

/**
 * What is remembered, as a React component sees it.
 *
 * Subscribed rather than read once, because the assistant writes to this while
 * the page is open: a conversation running in the background can learn the
 * user's name in the middle of them reading the file it is written to. Watching
 * it appear is the clearest possible answer to "is it actually remembering
 * anything", so the editor updates underneath them — unless they are typing,
 * which is the editor's own business and not this hook's.
 */
export const useMemoryDocs = (): VoiceMemory => {
  const [memory, setMemory] = useState<VoiceMemory>(peekVoiceMemory);

  useEffect(() => {
    let live = true;
    void readVoiceMemory()
      .then((stored) => {
        if (live) setMemory(stored);
      })
      .catch(() => {
        // An unreadable memory shows as the empty one, which is the honest
        // reading: nothing can be shown, and the editor still works.
      });

    const unsubscribe = subscribeVoiceMemory((next) => {
      if (live) setMemory(next);
    });

    return () => {
      live = false;
      unsubscribe();
    };
  }, []);

  return memory;
};
