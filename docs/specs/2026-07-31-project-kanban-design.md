# Project Kanban Design

**Date:** 2026-07-31
**Status:** First vertical slice implemented (migration, repository, service, routes, `config kanban` CLI, a
non-drag renderer UI in the project panel). Full drag-and-drop, column reordering, and the conversation link
(§7.3) remain as designed but unbuilt — see the note at the end of §7 and §7.3.
**Base:** The Fool v2.1.43, branch `feat/the-fool-windows-alpha`
**Depends on:** the project bind chain (migration `028_project_bind.sql`) and the project panel host

## 1. Objective

Give a project a board of work that both the user and the agents can see and move.

The app already knows what a project is, what its folders are, and which conversations belong to
it. What it has no place for is the thing a user actually holds in their head: what needs doing,
what is being done right now, and what is finished. Today that lives in the conversation list,
where an item's state is the state of a chat rather than the state of the work — a finished
conversation and an abandoned one look identical, and a task nobody has started yet does not exist
at all.

A board closes that gap, and in this app it can do something a generic board cannot: a card can be
handed to an agent, and it moves as the agent works.

## 2. Why this shape

Three facts about the codebase decide most of the design.

1. **The panel seam already exists.** `ProjectPanelHost` was named generically for exactly this —
   its own header says future project-scoped components "(source-control, kanban, …) can mount
   through the same seam without re-architecting the host". The board is the second tenant of a
   seam built for it.

2. **Everything configurable is reachable by an agent.** The Jester manages assistants, MCP
   servers, providers, scheduled tasks and app settings through `foolcore config`. A board the
   agents cannot read or write would be the first user-facing surface in the app that is
   agent-blind, and the least defensible one — a task board is _about_ work an agent does.

3. **Live change has a path now.** Preferences propagate over the event bus as of
   `settings.clientPreferencesChanged`. A board is the case that needs it most: two windows, an
   agent, and a phone can all be looking at the same column.

## 3. Scope

### 3.1 Included

- A per-project board with ordered columns and ordered cards.
- Card: title, markdown body, column, position, optional assignee label, optional due date.
- Default columns on first open of a project's board: **To do**, **Doing**, **Done**.
- Drag a card between and within columns; drag a column to reorder.
- Link a card to a conversation: open the linked chat from the card, or start a new conversation
  seeded with the card's title and body.
- Agent access through `foolcore config kanban …`, documented in the `fool-config` skill.
- Live updates in every open window and the WebUI, over the existing event bus.
- Board state survives restart; deleting a project deletes its board.

### 3.2 Excluded from this round

- Swimlanes, labels/tags, filters, search, card attachments, checklists, comments.
- Cross-project boards and a global "all my work" view.
- WIP limits, cycle-time metrics, burndown.
- Automatic card movement driven by agent progress. The link is manual in this round; §7.3
  explains why and what it would take.
- Import/export, and any sync with an external tracker.

## 4. Data model

New migration `036_project_kanban.sql`. Follows the conventions the project bind chain established:
business identity is a UUID v7 `TEXT`, the `INTEGER AUTOINCREMENT` id is internal only, no foreign
keys, enum semantics live in comments and are validated in the service layer.

```sql
-- One board per project. Created lazily, the first time a project's board is read.
CREATE TABLE IF NOT EXISTS kanban_columns (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    column_id   TEXT    NOT NULL,          -- stable identity, UUID v7
    project_id  TEXT    NOT NULL,
    user_id     TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kanban_columns_column_id_unique ON kanban_columns(column_id);
CREATE INDEX IF NOT EXISTS idx_kanban_columns_project_order ON kanban_columns(project_id, order_index);

CREATE TABLE IF NOT EXISTS kanban_cards (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id         TEXT    NOT NULL,      -- stable identity, UUID v7
    project_id      TEXT    NOT NULL,
    user_id         TEXT    NOT NULL,
    column_id       TEXT    NOT NULL,
    title           TEXT    NOT NULL,
    body            TEXT    NOT NULL DEFAULT '',
    assignee        TEXT,                  -- free-text label, not a user reference
    due_at          INTEGER,               -- epoch ms
    conversation_id TEXT,                  -- the chat this card is being worked in
    order_index     INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kanban_cards_card_id_unique ON kanban_cards(card_id);
CREATE INDEX IF NOT EXISTS idx_kanban_cards_column_order ON kanban_cards(column_id, order_index);
CREATE INDEX IF NOT EXISTS idx_kanban_cards_project ON kanban_cards(project_id);
CREATE INDEX IF NOT EXISTS idx_kanban_cards_conversation ON kanban_cards(conversation_id);
```

`user_id` is on both tables, matching `030_user_scope.sql`: a board is one user's, and the WebUI
can serve more than one.

`conversation_id` is deliberately not a foreign key and is allowed to dangle. A conversation the
user deletes must not take the card with it — the work still needs doing; only the record of where
it was being done has gone. The service reports a dangling link as "not linked" rather than as an
error, the same way a cloned voice with a missing recording is treated.

### 4.1 Ordering

`order_index` is a sparse integer, allocated in steps of 1024, so a card dropped between two
neighbours takes the midpoint and writes one row instead of renumbering the column. When two
midpoints collide the service renumbers that column and returns the fresh order. Reordering by
rewriting every row is the alternative, and it turns one drag into an _n_-row write that two
windows will race on.

## 5. Backend

New domain crate `fool-kanban`, following the required domain shape: `lib.rs` exports only,
`routes.rs` for request/response transformation, `service.rs` for all business logic and no axum
import, `state.rs` for the Arc-wrapped `KanbanRouterState`. Repository traits (`IKanbanRepository`)
in `fool-db` with a `SqliteKanbanRepository` implementation and row models under
`fool-db/src/models/`. Request/response types in `fool-api-types`; assembly in `fool-app`'s
`build_kanban_state()`.

### 5.1 Routes

All under `/api/projects/{project_id}/kanban`, all authenticated, all scoped to the current user.

| Method   | Path                   | Purpose                                                 |
| -------- | ---------------------- | ------------------------------------------------------- |
| `GET`    | `/`                    | The whole board: columns in order, each with its cards. |
| `POST`   | `/columns`             | Add a column.                                           |
| `PATCH`  | `/columns/{column_id}` | Rename or reorder a column.                             |
| `DELETE` | `/columns/{column_id}` | Remove a column. Refuses while it still holds cards.    |
| `POST`   | `/cards`               | Add a card.                                             |
| `PATCH`  | `/cards/{card_id}`     | Edit a card, move it between columns, or reposition it. |
| `DELETE` | `/cards/{card_id}`     | Remove a card.                                          |

`GET /` creates the three default columns on first read, in one transaction, and returns them.
Creating a board is not something a user should have to ask for.

A `PATCH` that moves a card carries `column_id` and the two neighbours it was dropped between
(`after_card_id`, `before_card_id`), not a computed `order_index`. The client knows where the card
was dropped; only the server knows what the ordering currently is, and a client-computed index is
stale the moment another window moves something.

### 5.2 Events

`kanban.boardChanged`, broadcast after any successful write, following the shape settled for
`settings.clientPreferencesChanged`:

```json
{ "user_id": "…", "project_id": "…", "change": "card" | "column" }
```

Names and scope only, no card content. The bus reaches every connection while a board belongs to
one user, so a payload carrying titles would hand one user's work to another. A client re-reads the
board through its own authenticated request, which can only return its own board, so an event about
somebody else costs a wasted read and changes nothing.

## 6. Agent access

`foolcore config kanban …`, alongside the existing config domains, so the Jester reaches a board the
same way it reaches everything else — stdin JSON, no business flags, read before write, read back
after.

```text
config kanban board          # the whole board for a project
config kanban cards create   # {project_id|current, column, title, body}
config kanban cards update   # {card_id, title?, body?, column?, after_card_id?, assignee?, due_at?}
config kanban cards delete   # {card_id}
config kanban columns create|update|delete
```

`"project_id": "current"` resolves from `FOOL_CONVERSATION_ID`, matching the existing `current`
selectors. Cards are addressed by title as well as id in `cards update`, because an agent that has
just read the board has the title in hand and the user speaks in titles; an ambiguous title is an
error rather than a guess.

The `fool-config` skill gains a **Kanban** section and `config_capabilities.rs` gains the domain, so
the commands are discoverable rather than guessed — the same failure the settings catalogue was
written to prevent.

This is what makes the board worth building rather than a second place to keep a list: "put
everything we did today on the board, and move the installer card to Done" becomes something the
user can say.

## 7. Renderer

### 7.1 The panel seam

`ProjectPanelHost` currently mounts `ExplorerContainer` directly. It gains a tab strip — **Files**
and **Board** — and mounts one of the two. The host's existing contract is unchanged: it still owns
width, collapse, border and lifecycle, still passes only `projectId`, and the hosted component still
self-manages its data. Both tenants stay mounted across a tab switch, for the reason the host
already keeps the Explorer mounted across conversation switches: teardown costs the WS
subscription and the scroll position, and the flicker is visible.

New files under `packages/desktop/src/renderer/pages/conversation/kanban/`:

| File              | Responsibility                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `KanbanBoard.tsx` | Fetch the board, render columns and cards, add/move/delete — everything, for this first slice. |

**Built as one file for this slice, not the six above.** Drag-and-drop, the
optimistic-move store, and a modal card editor are real work each; shipping
them half-done would have been worse than shipping a plainer version that
works end to end. What is built: fetching, rendering, adding a card, moving a
card between columns (a `Select` per card, not a drag handle), deleting a
card and a column, and a live refetch on `kanban.boardChanged` — the same
event an agent's write fires. The six-file split above is still where this
goes if drag-and-drop is built next; nothing here forecloses it.

### 7.2 Interaction

**As built:** moving a card is a column picker on the card, not a drag — see
the note above. A `kanban.boardChanged` event refetches the whole board, so
two windows and an agent stay in view of each other's changes.

**As designed, not yet built:**

- Drag is optimistic: the card moves under the cursor, the `PATCH` follows, and a failure snaps it
  back with an Arco `Message`. A board that waits for a round trip before the card moves feels
  broken on a slow machine, and this one talks to a local backend where the round trip is short
  enough that the snap-back is rare.
- Any drag in flight should win until its own response lands, so an agent moving one card cannot
  yank the card under the user's cursor. The current plain refetch does not yet make this
  guarantee — a `kanban.boardChanged` mid-drag will refetch and could move the card being dragged.
- Arco components only — `Modal`, `Input`, `Button`, `Select`, `DatePicker`. No raw interactive
  HTML. Icons from `@icon-park/react`. (This part is already true of what shipped.)
- Colours come from semantic tokens; column and card surfaces use `--color-bg-2` / `--color-bg-3`
  so a user theme restyles the board without the board knowing about themes. (Also already true.)

### 7.3 The conversation link — not yet built

A card carries an optional `conversation_id` in the data model and the API already (§4, §5.1), and
`cards update` can set or clear it. What is **not** built is the renderer side: a card does not yet
show an "Open chat" / "Start work" affordance, and nothing creates a conversation seeded from a
card's title and body. This is the one piece of the design with a real backend readiness gap: an
agent can link a card to a conversation right now via `config kanban cards update`; a person cannot
yet do the equivalent from the board itself.

Automatic movement — a card that walks itself to Done when the agent finishes — is deliberately out
of this round. The signal exists (`turn.completed` already carries the conversation), but "the turn
finished" and "the work is done" are different claims, and a board that quietly marks unfinished
work as finished is worse than one that does not move at all. Doing it honestly needs the agent to
state completion, which is a design of its own.

## 8. Internationalization

New module `kanban` in `packages/desktop/src/common/config/i18n-config.json`, with keys for the
column defaults, the card editor, the empty states and the error messages. Every user-facing string
is a key; the default column names are translated at creation time from the user's locale and
stored as plain text, because a user who renames a column must not have it renamed back by a
language switch.

## 9. Testing

| Layer         | Covers                                                                                                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fool-db`     | Repository CRUD and ordering against `init_database_memory()`, including the renumber path.                                                                                              |
| `fool-kanban` | Service rules: lazy board creation is idempotent, a non-empty column refuses deletion, a move between two neighbours lands between them, a dangling conversation link reads as unlinked. |
| `fool-app`    | Route integration: 401 unauthenticated, 404 unknown project, cross-user isolation, CSRF on writes, and `kanban.boardChanged` emitted with the right payload and no card content.         |
| Renderer unit | `kanbanStore` ordering, optimistic move and its rollback, refetch on event, drag in flight not clobbered.                                                                                |
| Renderer DOM  | Board renders columns and cards, the editor saves, the empty board shows its empty state.                                                                                                |
| E2E           | Create a card, drag it to another column, restart, and find it there.                                                                                                                    |

The cross-user isolation and payload tests are required by the backend's own rules for new
endpoints and new WebSocket events, not optional extras.

## 10. Implementation sequence

1. Migration and `fool-db` repository, with tests.
2. `fool-kanban` service and routes, with tests. No UI yet.
3. `fool-app` wiring, event emission, route integration tests.
4. `config kanban` commands, `config_capabilities.rs`, `fool-config` skill section.
5. Renderer: container, board, card, editor, store, hook. i18n keys.
6. `ProjectPanelHost` tab strip.
7. Conversation link.
8. E2E.

Steps 1–4 are shippable without any UI: the Jester can keep a board before a person can see one,
which is a real state to be in rather than an artefact of the ordering.

## 11. Open questions

1. **Board per project, or per project _and_ per conversation?** This design says per project. A
   long-lived project with many conversations may want a card that spans several, which the current
   shape allows, but a user who thinks in conversations may find the board too coarse.
2. **Does the phone need the board?** The WebUI serves the same renderer, so it arrives for free,
   but the drag interaction is a desktop one and needs a touch story before it can be called
   supported.
3. **What happens to a board when a project is deleted?** This design deletes it. The alternative —
   keeping it and offering it back when the folder is re-attached — is friendlier and costs an
   orphan-sweep on startup.
