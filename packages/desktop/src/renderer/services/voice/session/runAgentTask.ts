/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import i18next from 'i18next';
import { ipcBridge } from '@/common';
import type { IMcpServer, IProvider } from '@/common/config/storage';
import type { ChatFileRef } from '@/common/types/chatFile';
import { chatFileRefPath } from '@/common/types/chatFile';
import { isFoolrsAssistant, type Assistant } from '@/common/types/agent/assistantTypes';
import type { FoolVoiceSettings } from '@/common/types/foolVoice';
import { findPinnedAssistant, findPinnedModel } from './startVoiceConversation';

/**
 * A real task on this computer, run while the conversation carries on talking.
 *
 * The reason this exists rather than reusing the wake-word route: that route
 * *navigates* to the chat it opens. From a spoken conversation that is fatal —
 * the voice page unmounts, which closes the microphone, so asking the assistant
 * to do something ended the conversation in which you asked. Worse, the older
 * path only pre-filled the composer and never pressed send, so nothing ran at
 * all: the assistant would say it was on it and then sit there.
 *
 * So the chat is created, the message is sent and the turn is awaited entirely
 * in the background. The user hears "on it", the work happens, and the answer
 * comes back into the same conversation.
 */

export type AgentTaskRequest = {
  /** The task, in the user's own words. */
  request: string;
  settings: FoolVoiceSettings;
  /** Attached to the first message — the screen, when one was captured. */
  files?: readonly ChatFileRef[];
  /** Called as the agent reports what it is doing, for the activity list. */
  onProgress?: (detail: string) => void;
  signal?: AbortSignal;
};

export type AgentTaskResult =
  | { ok: true; conversationId: string; summary: string }
  | {
      ok: false;
      reason:
        /** Voice settings name no agent, so there is nothing to hand the task to. */
        | 'no-agent'
        /** The pinned agent is gone, or needs a model it was not given. */
        | 'agent-unavailable'
        | 'create-failed'
        | 'send-failed'
        /** The agent stopped without finishing, or reported an error. */
        | 'run-failed'
        /** The conversation ended, or the user talked over it. */
        | 'cancelled';
      detail?: string;
    };

/**
 * How long a task may run before it is given up on.
 *
 * Generous, because "open Discord and message my friend" is several minutes of
 * real work on a real desktop, and the conversation is not blocked while it
 * happens. Bounded all the same: a listener that never fires would otherwise be
 * held for the life of the app.
 */
const TASK_TIMEOUT_MS = 15 * 60_000;

/**
 * Text out of whatever shape a streamed message carried.
 *
 * Deliberately shape-tolerant rather than typed to one form, because the backend
 * broadcasts the stored row's content parsed as JSON — so `data` arrives as a
 * bare string on one message type and as `{ content: … }` or a list of parts on
 * another, and which one depends on the agent. Reading only one of them is how
 * a task that worked would come back with an empty answer.
 */
const summarise = (content: unknown): string => {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => summarise(part))
      .filter((part) => part.length > 0)
      .join(' ')
      .trim();
  }
  if (content !== null && typeof content === 'object') {
    const record = content as { text?: unknown; content?: unknown };
    if (typeof record.text === 'string') return record.text.trim();
    if (record.content !== undefined) return summarise(record.content);
  }
  return '';
};

/**
 * The MCP servers the user has switched on.
 *
 * `enabled` on a server means "checked by default in a new conversation", which
 * is exactly what a spoken task is — it just never had anyone to check the box.
 * Read fresh each time rather than cached: a server switched on while the app
 * is running should reach the next thing asked of it.
 *
 * An empty list on failure, which leaves the conversation on whatever it would
 * have had. A task that runs with fewer tools is worse than one that runs; a
 * task that does not run because the server list could not be read is worse
 * than both.
 */
const enabledMcpServerIds = async (): Promise<string[]> => {
  const servers = await ipcBridge.mcpService.listServers.invoke().catch((): IMcpServer[] => []);
  return (servers ?? []).filter((server) => server.enabled).map((server) => server.id);
};

/** Creates the chat this task runs in, on the agent voice settings pin. */
const openTaskConversation = async (
  request: AgentTaskRequest
): Promise<{ ok: true; conversationId: string; foolrs: boolean } | Extract<AgentTaskResult, { ok: false }>> => {
  const { assistantId, providerId, modelId, unattended } = request.settings.session;

  const [assistants, providers] = await Promise.all([
    ipcBridge.assistants.list.invoke().catch((): Assistant[] => []),
    ipcBridge.mode.listProviders.invoke().catch((): IProvider[] => []),
  ]);

  // Nothing pinned falls back to the first enabled agent — see
  // `findPinnedAssistant`. Refusing outright is what answered "open YouTube for
  // me" with an instruction to go and configure a setting that was already at
  // its default.
  const assistant = findPinnedAssistant(assistants ?? [], assistantId);
  if (!assistant)
    return { ok: false, reason: assistantId.length === 0 ? 'no-agent' : 'agent-unavailable', detail: assistantId };

  const model = findPinnedModel(providers ?? [], providerId, modelId);
  const foolrs = isFoolrsAssistant(assistant);
  // The Fool CLI backend is handed the provider record itself; without one there
  // is nothing to create the conversation with.
  if (foolrs && !model) return { ok: false, reason: 'agent-unavailable', detail: modelId };

  // An ACP agent names models in its own namespace, so a pinned id that matches
  // no provider is passed through rather than dropped — see
  // `startVoiceConversation` for the same reasoning at length.
  const overrideModelId = model?.use_model ?? (modelId.length > 0 ? modelId : undefined);
  const files = request.files ?? [];
  const mcpIds = await enabledMcpServerIds();

  try {
    const conversation = await ipcBridge.conversation.create.invoke({
      name: request.request,
      ...(model ? { model } : {}),
      assistant: {
        id: assistant.id,
        locale: i18next.language || 'en-US',
        conversation_overrides: {
          model: overrideModelId,
          // A spoken conversation cannot answer a confirmation. The prompt
          // opens in a chat window the user is not looking at, the task waits
          // on it for fifteen minutes, and the model — having called a tool and
          // been told nothing — says the work is done. "I've opened your
          // browser and searched for Spider-Man", with nothing opened.
          //
          // Stalling is not the safe option here; it is the one that produces a
          // false report. So a spoken task acts unattended unless the user has
          // said otherwise in the panel beside the microphone.
          ...(unattended ? { permission: 'yolo' } : {}),
          // Without this the task runs with no MCP servers at all. A built-in
          // assistant materialises with `mcps: auto` and no remembered
          // selection, which resolves to an empty list — so asked to search a
          // page it had just opened, the agent answered that it "cannot browse
          // external websites" and was "limited to local file operations". It
          // was: it had no screen, no mouse and no keyboard.
          //
          // The assistant's own default cannot carry this. Setting
          // `defaults.mcps` on a built-in is refused outright — that field
          // belongs to the manifest, not to callers. The per-conversation
          // override is the layer that is ours to set, and it outranks both.
          ...(mcpIds.length > 0 ? { mcp_ids: mcpIds } : {}),
        },
      },
      extra: { workspace: '', custom_workspace: false, default_files: files.map(chatFileRefPath) },
    });
    if (!conversation?.id) return { ok: false, reason: 'create-failed' };
    return { ok: true, conversationId: conversation.id, foolrs };
  } catch (error) {
    return { ok: false, reason: 'create-failed', detail: error instanceof Error ? error.message : undefined };
  }
};

/** The last line of a streamed step, short enough for a one-line activity row. */
const progressLine = (data: unknown): string => {
  const text = summarise(data);
  if (text.length === 0) return '';
  return text.split('\n').at(-1)?.trim().slice(0, 160) ?? '';
};

/**
 * Watches one conversation until it has answered.
 *
 * Subscribed *before* the message is sent, because a short task can finish
 * before this code would otherwise have started listening — and a completion
 * event missed is a task that appears to hang forever.
 *
 * Two things are watched, and they answer different questions. The response
 * stream carries what the agent is writing, so it is where the reply itself
 * comes from; `turn.completed` carries whether the turn ended and how, which the
 * stream does not say when a run stops on an error. Whichever arrives first
 * settles it.
 */
const awaitTurn = (
  conversationId: string,
  onProgress: ((detail: string) => void) | undefined,
  signal: AbortSignal | undefined
): { finished: Promise<AgentTaskResult>; stop: () => void } => {
  let settle: (result: AgentTaskResult) => void = () => undefined;
  const finished = new Promise<AgentTaskResult>((resolve) => (settle = resolve));

  const unsubscribers: (() => void)[] = [];
  let timer: number | null = null;
  let done = false;
  /** What the agent has written so far, which becomes the spoken answer. */
  let written = '';

  const stop = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    for (const off of unsubscribers) off();
    unsubscribers.length = 0;
  };

  const finish = (result: AgentTaskResult): void => {
    if (done) return;
    done = true;
    stop();
    settle(result);
  };

  unsubscribers.push(
    ipcBridge.conversation.responseStream.on((message) => {
      if (message.conversation_id !== conversationId) return;
      // The request comes back on the same channel as the answer, on the right of
      // the conversation. Accumulating it would make the task's own instruction
      // part of what gets read out as its result.
      if (message.position === 'right') return;

      if (message.type === 'content' || message.type === 'text') {
        const text = summarise(message.data);
        if (text.length > 0) {
          written += written.length > 0 ? ` ${text}` : text;
          onProgress?.(progressLine(message.data));
        }
        return;
      }
      if (message.type === 'finish') {
        finish({ ok: true, conversationId, summary: written.trim() });
        return;
      }
      if (message.status === 'error') {
        finish({ ok: false, reason: 'run-failed', detail: progressLine(message.data) });
        return;
      }
      // Every other step — a tool call, a file read — is progress and nothing
      // more. Named where it names itself, so the activity row says what the
      // agent is doing rather than repeating the request.
      const detail = progressLine(message.data);
      if (detail.length > 0) onProgress?.(detail);
    })
  );

  unsubscribers.push(
    ipcBridge.conversation.turnCompleted.on((event) => {
      if (event.session_id !== conversationId) return;
      if (event.status !== 'finished') return;
      if (event.state === 'error') {
        finish({ ok: false, reason: 'run-failed', detail: event.detail });
        return;
      }
      finish({
        ok: true,
        conversationId,
        summary: written.trim() || summarise(event.last_message?.content),
      });
    })
  );

  if (signal) {
    if (signal.aborted) finish({ ok: false, reason: 'cancelled' });
    else signal.addEventListener('abort', () => finish({ ok: false, reason: 'cancelled' }), { once: true });
  }

  timer = window.setTimeout(() => finish({ ok: false, reason: 'run-failed', detail: 'timeout' }), TASK_TIMEOUT_MS);

  return { finished, stop };
};

/**
 * Hands a task to the agent and resolves with what it reports back.
 *
 * Never throws: every failure is a reason the caller can say out loud, because
 * the caller is a conversation and an unhandled rejection there is silence.
 */
export const runAgentTask = async (request: AgentTaskRequest): Promise<AgentTaskResult> => {
  const opened = await openTaskConversation(request);
  if (opened.ok === false) return opened;

  const { conversationId } = opened;
  const watch = awaitTurn(conversationId, request.onProgress, request.signal);

  try {
    // The runtime has to be up before a message will be accepted; the chat page
    // normally does this on mount, and there is no page here.
    // Failure is not fatal: a backend that starts the runtime on first message
    // accepts one anyway, and this is only here for the one that does not.
    await ipcBridge.conversation.ensureRuntime
      .invoke({ conversation_id: conversationId })
      .catch((): undefined => undefined);

    await ipcBridge.conversation.sendMessage.invoke({
      conversation_id: conversationId,
      input: request.request,
      ...(request.files && request.files.length > 0 ? { files: [...request.files] } : {}),
    });
  } catch (error) {
    watch.stop();
    return { ok: false, reason: 'send-failed', detail: error instanceof Error ? error.message : undefined };
  }

  return watch.finished;
};
