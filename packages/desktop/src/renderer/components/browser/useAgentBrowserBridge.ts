/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import { ipcBridge } from '@/common';
import { parseBrowserCommand, parseFailed } from '@/common/browser/browserCommands';
import { runAgentBrowserCommand } from './agentBrowserController';

/**
 * Answers browser commands on behalf of the agent.
 *
 * The renderer is the provider here rather than the consumer, which is the
 * other way round from most of this app's bridges — but the webview only exists
 * on this side, so this is where a command has to be executed. The main process
 * invokes; this replies.
 *
 * The payload is parsed again here even though the main process already parsed
 * it. That is not redundancy for its own sake: this is the last point before an
 * expression is built and evaluated inside a page the user is signed into, and
 * the cost of checking twice is nothing against the cost of trusting a caller.
 */
export const useAgentBrowserBridge = (): void => {
  useEffect(() => {
    const endpoint = ipcBridge.agentBrowser?.run;
    // Absent in the browser build, which has no main process to ask.
    if (typeof endpoint?.provider !== 'function') return;

    return endpoint.provider(async ({ command }) => {
      const parsed = parseBrowserCommand(command);
      if (parseFailed(parsed)) return { ok: false, error: parsed.error };
      return runAgentBrowserCommand(parsed.command);
    });
  }, []);
};
