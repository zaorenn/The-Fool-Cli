---
name: shared-memory
description: Read what earlier versions of The Fool stored in the old shared-memory file. Superseded by the `memory` skill, which is where anything new belongs — use this only to look up something that was saved before, or to move it across.
---

# Shared Memory (the old store)

This is a JSON file, `~/.the-fool/shared-memory.json`, holding a flat list of
preferences saved by earlier versions. **It is not where memory lives any more.**

What replaced it is two markdown documents the user can read and edit in
Settings → Memory — see the `memory` skill, which you already have. That was the
whole point of the change: a memory kept in a file nobody can open is a memory
nobody can correct, and this one was invisible to the person it was about.

## Read it, do not add to it

```text
node <this-skill>/scripts/shared-memory.mjs list
node <this-skill>/scripts/shared-memory.mjs search <query>
```

Worth one look when something about the user would help and the two documents do
not have it — an install that has been here a while may have preferences in here
that were never carried across.

If you find something in here that is still true and still useful, put it in
`user.md` through the `memory` skill and say so. That is a migration, not a
duplication: the user can see it there and cross it out if it is wrong.

**Do not call `remember`.** It still works, and everything written through it
lands somewhere the user cannot see, which is how they came to have two memories
that disagreed. Anything worth keeping goes into `user.md` or `agent.md`.
