---
name: visual-companion
description: Create an interactive UI/design draft, open it in The Fool Browser panel, collect comments and explicit approval, and only then implement it. Use for UI proposals, mockups, layout choices, and visual iteration.
---

# Visual Companion

This skill is shared with every agent and all agents through The Fool's auto-injected builtin skill pool.

## Non-negotiable gate

Do not edit or write to the user's project while a design session is awaiting review. Explicit user approval in the Visual Companion is required before implementation. A comment, click, browser close, or lack of feedback is not approval.

## Workflow

1. Create one self-contained HTML draft in the task's temporary working area. Make it responsive and interactive enough to test the important behavior. Do not copy application secrets or private data into it.
2. Start a session:

   ```text
   node <this-skill>/scripts/visual-companion.mjs start <absolute-html-path>
   ```

   The command returns JSON containing `url`, `eventsCommand`, and `sessionId`.

3. Use the shared Browser tool to open `url` in The Fool Browser panel. Tell the user what decision the draft is asking them to make.
4. Poll feedback by running the returned `eventsCommand`. Revise the temporary HTML and start a new session when the user requests changes.
5. Continue to implementation only after an event with `type: "design.approved"` is present. Treat `design.comment` events as requested revisions, not approval.

## Quality bar

- Match the current application theme and component language; avoid generic gradient-heavy AI styling.
- Show real states and realistic content, not decorative placeholders.
- Keep the review question narrow enough for the user to answer.
- Explain which files would change after approval, but do not change them before approval.
- Preserve the existing architecture; a visual draft is evidence for a change, not permission to redesign unrelated areas.

## Security

The launcher binds only to `127.0.0.1`, uses an unguessable token, isolates draft HTML in a sandboxed iframe, applies a restrictive CSP, bounds event payloads, and stores session state under the operating system temporary directory. Never remove these controls or expose the session on a LAN interface.
