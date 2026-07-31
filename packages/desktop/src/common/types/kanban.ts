/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Wire shapes for the project Kanban board. Mirrors
 * `backend/core/crates/fool-api-types/src/kanban.rs` — keep the two in step
 * by hand; this is a plain data contract, not shared code.
 */

export type KanbanCard = {
  card_id: string;
  column_id: string;
  title: string;
  body: string;
  assignee?: string;
  due_at?: number;
  conversation_id?: string;
  order_index: number;
  created_at: number;
  updated_at: number;
};

export type KanbanColumn = {
  column_id: string;
  name: string;
  order_index: number;
  cards: KanbanCard[];
};

export type KanbanBoard = {
  columns: KanbanColumn[];
};
