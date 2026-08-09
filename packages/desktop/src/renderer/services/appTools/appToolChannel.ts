/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import i18next from 'i18next';
import { ipcBridge } from '@/common';
import { configService } from '@/common/config/configService';
import { LOCAL_SKILLS_CONFIG_KEY } from '@/common/voice/localSkills';
import { peekLocalSkills } from '@renderer/services/voice/session/localSkillStore';
import { judge } from '@renderer/services/permissions/permissionStore';
import { runVoiceTool } from '@renderer/pages/voice/runtime/toolRunner';
import type { ToolHost } from '@renderer/pages/voice/runtime/types';
import { CORE_APP_TOOLS, describeAppTools } from './toolDescriptors';

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
  // There is no room to interrupt: an agent turn is not a conversation, and it
  // has its own way of reporting what it delegated. The promise is still
  // swallowed rather than dropped — an unhandled rejection here would surface
  // as a crash in a window nobody has open.
  announceLater: (_what, finished): void => {
    void finished.catch((): undefined => undefined);
  },
});

/**
 * What a model is told when the rules refuse a call.
 *
 * Written as a sentence it can repeat, and as a refusal rather than a failure:
 * the difference matters, because a model told "that did not work" will try
 * again, and one told "you are not allowed to do that" will say so.
 */
const REFUSED = 'This is not allowed without the user agreeing to it first, and they have not been asked yet.';

/**
 * The path or command a rule can be about, dug out of the arguments.
 *
 * Best-effort by name, because the app's own tools do not share one argument
 * shape. A call whose target cannot be found is judged on its tool alone, which
 * — with a default of `ask` — is the safe direction to be wrong in.
 */
const targetOf = (args: Record<string, unknown>): { path?: string; command?: string } => {
  const pick = (key: string): string | undefined => (typeof args[key] === 'string' ? (args[key] as string) : undefined);
  return {
    path: pick('path') ?? pick('file_path') ?? pick('url'),
    command: pick('command') ?? pick('request'),
  };
};

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
 * Two things are guaranteed here and nowhere else. Every request gets exactly
 * one answer, including when the answer is a refusal or a timeout. And nothing
 * runs before the permission layer has judged it — the judging happens on this
 * side of the boundary, before the handler is even reached, so a tool cannot be
 * half-run and then denied.
 */
export const startAppToolChannel = (): (() => void) => {
  const register = (): void => {
    // The taught skills go out with the catalogue, so every agent that can act
    // for this person knows what they have already been taught — not just the
    // spoken conversation, which was the only one told.
    void ipcBridge.appTools.catalogue.invoke({
      tools: describeAppTools(peekLocalSkills()),
      core: [...CORE_APP_TOOLS],
    });
  };

  register();
  // The catalogue lives in the backend's memory, so a backend that restarted
  // has forgotten it — and an agent would then be told this application can do
  // nothing, silently. `realtime.reconnected` exists for exactly this: the
  // caller re-declares its state.
  const stopReconnect = ipcBridge.realtime.reconnected.on(register);
  // A skill taught a minute ago has to be callable now. Without this the names
  // in the catalogue are the ones that existed when the window opened, and the
  // first thing a user does after teaching one is ask for it.
  const stopSkillWatch = configService.subscribe(LOCAL_SKILLS_CONFIG_KEY, register);

  const stopRequests = ipcBridge.appTools.request.on(async (request: AppToolRequest) => {
    try {
      const args = request.arguments ?? {};
      // Consulted before anything runs. `ask` puts a card in front of the user
      // and waits; an unanswered card refuses on their behalf, because during a
      // spoken conversation nobody is looking at one.
      const verdict = await judge({ tool: request.name, ...targetOf(args) }, request.conversation_id);
      if (verdict !== 'allow') {
        await ipcBridge.appTools.result.invoke({ call_id: request.call_id, ok: false, content: REFUSED });
        return;
      }

      const result = await runVoiceTool(agentToolHost(request.conversation_id), {
        callId: request.call_id,
        name: request.name,
        argumentsJson: JSON.stringify(args),
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

  return () => {
    stopReconnect();
    stopSkillWatch();
    stopRequests();
  };
};
