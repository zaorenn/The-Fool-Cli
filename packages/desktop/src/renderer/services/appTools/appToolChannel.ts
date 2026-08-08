/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import i18next from 'i18next';
import { ipcBridge } from '@/common';
import { runVoiceTool } from '@renderer/pages/voice/runtime/toolRunner';
import type { ToolHost } from '@renderer/pages/voice/runtime/types';
import { describeAppTools } from './toolDescriptors';

/** An agent asking the application to do something only it can do. */
type AppToolRequest = {
  conversation_id: string;
  call_id: string;
  name: string;
  arguments?: Record<string, unknown>;
};

/**
 * What a tool handler is lent when its caller is an agent rather than a spoken
 * conversation.
 *
 * Most of `ToolHost` is about a conversation happening out loud — the activity
 * list beside the microphone, giving the floor back, the "still on it"
 * heartbeat. None of that exists here, and pretending otherwise would put rows
 * on a panel nobody is looking at. What does carry over is `t`: a tool that
 * fails has to say so in the user's language wherever it was called from.
 */
const agentToolHost = (_conversationId: string): ToolHost => ({
  t: (key, values) => String(i18next.t(key, values as never)),
  updateActivity: () => undefined,
  backToListening: () => undefined,
  flushOutput: () => undefined,
  setStandby: () => undefined,
  // The contract asks for the way to stop; there is nobody to talk to
  // meanwhile, so it starts nothing.
  startWorkingHeartbeat: () => () => undefined,
  // A rule set from an agent turn would bind a spoken conversation that may not
  // exist. Rules meant to last go through the memory instead.
  setSessionRule: () => undefined,
  dropSessionRule: () => undefined,
});

/**
 * Whether a handler's own return says it worked.
 *
 * Handlers answer `{ ok: false, error }` for a request they understood and
 * could not carry out. That is a failure the model must hear about, not a
 * result to report as success — reporting it as success is the exact lie this
 * application spent four releases making impossible.
 */
const succeeded = (result: Record<string, unknown>): boolean => result.ok !== false;

/**
 * Answers an agent asking the application to do something.
 *
 * The work itself is `runVoiceTool`, unchanged: it was already the one place
 * that knows how to look at a screen or change a theme. What is new is that its
 * caller can now be an agent rather than a spoken conversation, which is the
 * whole of this piece of work.
 *
 * Nothing here decides whether a tool is *allowed* to run; that belongs to the
 * permission layer and is its own sub-project. This guarantees one thing only:
 * every request gets exactly one answer.
 */
export const startAppToolChannel = (): (() => void) => {
  void ipcBridge.appTools.catalogue.invoke({ tools: describeAppTools() });

  return ipcBridge.appTools.request.on(async (request: AppToolRequest) => {
    try {
      const result = await runVoiceTool(agentToolHost(request.conversation_id), {
        callId: request.call_id,
        name: request.name,
        argumentsJson: JSON.stringify(request.arguments ?? {}),
      });
      await ipcBridge.appTools.result.invoke({
        call_id: request.call_id,
        ok: succeeded(result),
        content: JSON.stringify(result),
      });
    } catch (error) {
      // Always an answer. A handler that throws and posts nothing leaves the
      // agent waiting for the whole deadline and the user listening to
      // silence — which is indistinguishable from the app having crashed.
      await ipcBridge.appTools.result.invoke({
        call_id: request.call_id,
        ok: false,
        content: error instanceof Error ? error.message : String(error),
      });
    }
  });
};
