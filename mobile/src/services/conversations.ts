/**
 * Conversations, over the transport that still carries them.
 *
 * The app used to ask for these on the WebSocket bridge, with names like
 * `database.get-user-conversations`. Those channels no longer exist anywhere in
 * the desktop — the server accepts the message and never answers, which is why
 * connecting successfully still produced empty screens. The data moved to REST
 * on foolcore, and the desktop's own bridge now reaches it there.
 *
 * Written against the same routes `common/adapter/ipcBridge.ts` calls, so the
 * two clients ask the same server the same questions.
 */

import { api } from './api';

/** The envelope foolcore wraps every REST answer in. */
type ApiEnvelope<T> = { success: boolean; data: T; error?: string };

/** One page of conversations, as `GET /api/conversations` returns it. */
export type ConversationPage<T> = {
  items: T[];
  total: number;
  hasMore: boolean;
};

/**
 * Unwrap an answer, or say which call failed.
 *
 * The envelope is uniform, so a bare `response.data.data` would work — and
 * would turn a server-side refusal into `undefined` flowing onward, which is
 * the failure mode that made the old bridge silence look like empty data.
 */
function unwrap<T>(payload: ApiEnvelope<T> | undefined, call: string): T {
  if (!payload || payload.success !== true) {
    throw new Error(`${call} failed: ${payload?.error ?? 'no response'}`);
  }
  return payload.data;
}

/**
 * The conversations this user has.
 *
 * `has_more` is snake_case on the wire and camelCase here, renamed once at the
 * boundary rather than spread through the screens.
 */
export async function listConversations<T = unknown>(params?: {
  limit?: number;
  offset?: number;
}): Promise<ConversationPage<T>> {
  const response = await api.get<ApiEnvelope<{ items: T[]; total: number; has_more: boolean }>>(
    '/api/conversations',
    { params }
  );
  const page = unwrap(response.data, 'listConversations');
  return { items: page.items ?? [], total: page.total ?? 0, hasMore: page.has_more === true };
}

/** The messages in one conversation, oldest first. */
export async function listMessages<T = unknown>(conversationId: string): Promise<T[]> {
  const response = await api.get<ApiEnvelope<T[]>>(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages`
  );
  return unwrap(response.data, 'listMessages') ?? [];
}

/** Start a conversation. The body is whatever the server's create schema takes. */
export async function createConversation<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const response = await api.post<ApiEnvelope<T>>('/api/conversations', body);
  return unwrap(response.data, 'createConversation');
}

/**
 * Change a conversation in place.
 *
 * `merge_extra` travels in the body rather than as a query flag, matching the
 * desktop's `conversation.update`.
 */
export async function updateConversation(
  conversationId: string,
  updates: Record<string, unknown>,
  mergeExtra?: boolean
): Promise<void> {
  const response = await api.patch<ApiEnvelope<boolean>>(
    `/api/conversations/${encodeURIComponent(conversationId)}`,
    { ...updates, merge_extra: mergeExtra }
  );
  unwrap(response.data, 'updateConversation');
}

/** Delete a conversation. */
export async function removeConversation(conversationId: string): Promise<void> {
  const response = await api.delete<ApiEnvelope<boolean>>(
    `/api/conversations/${encodeURIComponent(conversationId)}`
  );
  unwrap(response.data, 'removeConversation');
}
