/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { configService } from '@/common/config/configService';
import { emitter } from '@/renderer/utils/emitter';
import { useEffect } from 'react';
import type { TFunction } from 'i18next';
import type { NavigateFunction } from 'react-router-dom';

/** The built-in assistant, registered by migration 035. */
const BUTLER_ASSISTANT_ID = 'fool-assistant';

export type FirstRunSetupDeps = {
  navigate: NavigateFunction;
  localeKey: string;
  t: TFunction;
};

/**
 * Whether this launch should hand the user to The Jester for setup.
 *
 * Two conditions, and both matter. The flag alone would re-run onboarding for
 * anyone upgrading into this build; the provider check alone would re-run it
 * every launch for someone who deliberately deleted their last provider.
 *
 * Exported for tests — the decision is the whole risk here, not the navigation.
 */
export const shouldGreetOnFirstRun = (alreadyGreeted: boolean | undefined, providerCount: number): boolean =>
  alreadyGreeted !== true && providerCount === 0;

/**
 * On a first launch with nothing configured, open a conversation with The
 * Jester and let it walk the user through setup.
 *
 * The Jester is already the butler for this — it holds the `fool-config` skill,
 * which can create providers, fetch their models, health-check them, enable
 * agents and write themes. What was missing was simply putting a new user in
 * front of it instead of an empty prompt box.
 */
export const useFirstRunSetup = ({ navigate, localeKey, t }: FirstRunSetupDeps): void => {
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const alreadyGreeted = await configService.get('system.firstRunGreeted');
        if (cancelled || alreadyGreeted === true) return;

        const providers = await ipcBridge.mode.listProviders.invoke();
        if (cancelled) return;

        if (!shouldGreetOnFirstRun(alreadyGreeted, providers?.length ?? 0)) {
          // Nothing to set up, but never ask again either.
          await configService.setLocal('system.firstRunGreeted', true);
          return;
        }

        const conversation = await ipcBridge.conversation.create.invoke({
          name: t('guid.firstRun.conversationName'),
          assistant: { id: BUTLER_ASSISTANT_ID, locale: localeKey },
          // No workspace: setup is about the app itself, so this conversation
          // has no business being bound to a folder on disk.
          extra: {},
        });
        if (cancelled || !conversation?.id) return;

        // Claim the flag before navigating: if the opening turn fails, a retry
        // loop that recreates a conversation on every launch is far worse than
        // a user who opens settings themselves.
        await configService.setLocal('system.firstRunGreeted', true);

        // Same handoff the welcome screen uses — the conversation view picks
        // this up and sends it as the opening turn.
        sessionStorage.setItem(
          `acp_initial_message_${conversation.id}`,
          JSON.stringify({ input: t('guid.firstRun.openingMessage') })
        );

        emitter.emit('chat.history.refresh');
        await navigate(`/conversation/${conversation.id}`);
      } catch (error) {
        // A failed greeting must never block the app from opening.
        console.error('[first-run] Could not hand setup to the assistant:', error);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Runs once per app start; the deps are stable for that lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
};
