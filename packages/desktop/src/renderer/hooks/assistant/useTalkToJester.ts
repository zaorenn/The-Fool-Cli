/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { globalNavigate } from '@/renderer/utils/navigation';
import { Message } from '@arco-design/web-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { mutate as swrMutate } from 'swr';

/** Backend manifest id of the built-in The Fool Jester assistant. */
const JESTER_ASSISTANT_ID = 'fool-assistant';

export type TalkToJesterArgs = {
  /** Prompt pre-filled into the home chat input. */
  prompt: string;
  /** Optional file paths pre-attached to the input (e.g. report screenshots). */
  files?: string[];
};

/**
 * Resolve the Jester assistant from the catalog, tolerating the `builtin-`
 * prefix the frontend sometimes carries on built-in ids.
 */
const findJester = (assistants: Assistant[]): Assistant | undefined => {
  const candidates = new Set([JESTER_ASSISTANT_ID, `builtin-${JESTER_ASSISTANT_ID}`]);
  return assistants.find(
    (assistant) => candidates.has(assistant.id) || assistant.id.replace(/^builtin-/, '') === JESTER_ASSISTANT_ID
  );
};

/**
 * Shared entry point behind every "via chat" action: jump to the home page,
 * select the The Fool Jester, and pre-fill the chat input with a ready-made
 * prompt (and optional attachments). Auto-enables the Jester if the user has
 * disabled it, since clicking the action is an explicit intent to use it.
 *
 * Reuses the home page's `prefillPrompt` navigation contract (added with the
 * scheduled-tasks "create via chat" entry) and extends it with `prefillFiles`.
 * Uses `globalNavigate` rather than `useNavigate` so it is safe to call from
 * components mounted outside the Router (e.g. the global FeedbackReportModal).
 */
export const useTalkToJester = (): ((args: TalkToJesterArgs) => Promise<void>) => {
  const { t } = useTranslation();

  return useCallback(
    async ({ prompt, files }: TalkToJesterArgs) => {
      let selectedAssistantId: string | undefined;

      try {
        const assistants = await ipcBridge.assistants.list.invoke();
        const jester = findJester(assistants);
        if (jester) {
          selectedAssistantId = jester.id;
          if (jester.enabled === false) {
            await ipcBridge.assistants.setState.invoke({ id: jester.id, enabled: true });
            await swrMutate('assistants.list');
            Message.success(
              t('settings.talkToJester.enabledToast', { defaultValue: 'Enabled the The Fool Jester for you' })
            );
          }
        }
      } catch (error) {
        // Non-fatal: fall through to the home page with the prompt pre-filled
        // but no assistant pinned, rather than blocking the user.
        console.error('[talkToJester] failed to resolve/enable jester:', error);
      }

      globalNavigate('/guid', {
        state: {
          selectedAssistantId,
          prefillPrompt: prompt,
          prefillFiles: files,
        },
      });
    },
    [t]
  );
};

export default useTalkToJester;
