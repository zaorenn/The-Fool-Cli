---
name: shared-memory
description: Persist user-approved, non-sensitive preferences shared with every agent in The Fool.
---

# Shared Memory

Use `scripts/shared-memory.mjs` to read durable preferences shared with every agent and model in The Fool.

- Call `search <query>` when earlier preferences can improve the current task.
- Call `remember` only when the user explicitly asks to remember something or clearly approves persistence.
- Never store secrets, credentials, authentication tokens, private keys, or raw sensitive documents.
- Keep memories short, factual, and useful across conversations.

`remember` accepts JSON on stdin with `text` and optional `tags`. `search` and `list` return JSON on stdout.
