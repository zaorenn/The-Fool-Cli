------------------------------------------------------------------------
-- Project Kanban board: kanban_columns / kanban_cards
--
-- One board per project, created lazily on first read. Follows the project
-- bind chain's conventions (028_project_bind.sql): UUID v7 TEXT business
-- identity, INTEGER AUTOINCREMENT internal surrogate only, no FOREIGN KEY,
-- enum semantics validated in the service layer.
------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS kanban_columns (
    id          INTEGER PRIMARY KEY AUTOINCREMENT, -- internal surrogate, not a business identity
    column_id   TEXT    NOT NULL,                  -- stable identity, UUID v7
    project_id  TEXT    NOT NULL,
    user_id     TEXT    NOT NULL,                   -- a board is one user's; the WebUI may serve more than one
    name        TEXT    NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0,          -- sparse, steps of 1024 (see fool-kanban ordering)
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kanban_columns_column_id_unique ON kanban_columns(column_id);
CREATE INDEX IF NOT EXISTS idx_kanban_columns_project_order ON kanban_columns(project_id, order_index);

CREATE TABLE IF NOT EXISTS kanban_cards (
    id              INTEGER PRIMARY KEY AUTOINCREMENT, -- internal surrogate, not a business identity
    card_id         TEXT    NOT NULL,                   -- stable identity, UUID v7
    project_id      TEXT    NOT NULL,
    user_id         TEXT    NOT NULL,
    column_id       TEXT    NOT NULL,
    title           TEXT    NOT NULL,
    body            TEXT    NOT NULL DEFAULT '',
    assignee        TEXT,                                -- free-text label, not a user reference
    due_at          INTEGER,                              -- epoch ms
    conversation_id TEXT,                                 -- the chat this card is being worked in; allowed to dangle
    order_index     INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kanban_cards_card_id_unique ON kanban_cards(card_id);
CREATE INDEX IF NOT EXISTS idx_kanban_cards_column_order ON kanban_cards(column_id, order_index);
CREATE INDEX IF NOT EXISTS idx_kanban_cards_project ON kanban_cards(project_id);
CREATE INDEX IF NOT EXISTS idx_kanban_cards_conversation ON kanban_cards(conversation_id);
