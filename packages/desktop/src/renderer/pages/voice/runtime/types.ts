/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What a running conversation looks like from outside it.
 *
 * Shared between the runtime that produces these and the tool handlers that
 * report into them, so neither has to import the other's module to be typed.
 */

export type ConversationPhase =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'hearing'
  | 'thinking'
  | 'speaking'
  | 'acting'
  /** Told to wait: still connected and still listening, saying nothing. */
  | 'standby';

export type ConversationActivity = {
  id: string;
  label: string;
  detail: string;
  state: 'running' | 'completed' | 'failed';
};

/**
 * The i18n lookup, as much of it as anything outside React needs.
 *
 * The runtime lives outside the component tree, so it cannot call
 * `useTranslation`. The page hands its own `t` over when it mounts, and it keeps
 * working afterwards — which is the point: a conversation that outlives the page
 * still has to be able to name what it is doing.
 */
export type Translate = (key: string, values?: Record<string, unknown>) => string;

/** Everything the runtime lends a tool handler while it runs one. */
export type ToolHost = {
  t: Translate;
  /** Reports progress for the call being run, on screen and on the notch. */
  updateActivity: (id: string, patch: Partial<ConversationActivity>) => void;
  /** Back to hearing the user, for a tool that has finished with the floor. */
  backToListening: () => void;
  /** Empties the speaker, for a tool that has to stop a reply mid-sentence. */
  flushOutput: () => void;
  setStandby: (waiting: boolean) => void;
  /**
   * Starts saying "still on it" now and then, and hands back the way to stop.
   *
   * The caller must always run the returned function: a heartbeat that outlives
   * its task talks about work nobody is doing.
   */
  startWorkingHeartbeat: () => () => void;
};

/** One tool call, in the shape both transports normalise to. */
export type ToolInvocation = { callId: string; name: string; argumentsJson: string };
