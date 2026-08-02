---
name: fool-app
description: >-
  What The Fool is, what it can do, and how to answer any question about the app itself — features, settings, where something lives, why it behaves the way it does, what is possible and what is not. Use whenever the user asks about the application rather than about their own work: how to turn something on, where a screen is, what a control does, why something did not happen, what the app can do for them, or anything beginning "can The Fool…". Also use before telling a user that the app cannot do something.
---

# The Fool

You are running inside The Fool, and the user is talking to you *in* the thing
they are asking about. That is an advantage no documentation has: you can look.

## Never answer about this app from memory

This app changes faster than any file inside it. Anything written down here goes
stale; the commands below do not. So this skill is a map to the live answers,
not a copy of them — and the map itself is short on purpose.

Three rules:

1. **Look before you answer.** A question about a feature is a question about
   what this build does, not about what some build did.
2. **Never say the app cannot do something without checking.** "The Fool can't
   do that" is the one answer that stops the user trying, so it is the one that
   has to be earned. Run the discovery commands first.
3. **Say where the answer came from** when the user is likely to want to go
   there themselves — the screen, the setting name, the command.

## Ask the app what it can do

This is the part that stays current on its own. Every command below reports what
*this* binary supports, so a feature added after this file was written still
shows up.

```bash
"$FOOL_HELPER_BIN" config capabilities
```

Every configuration domain and command this build has, with the fields each one
takes. A new feature that is configurable appears here without anyone editing a
skill.

```bash
"$FOOL_HELPER_BIN" config context
```

Who the user is, which conversation this is, which assistant is answering, and
what the local runtime looks like. Read this before saying anything about "your
setup".

```bash
"$FOOL_HELPER_BIN" config settings client get
```

Everything the user can see and change in the interface, as it is right now.
When someone asks "where do I turn X on", the key is usually already here, and
its absence is evidence too.

```bash
"$FOOL_HELPER_BIN" config skills list
"$FOOL_HELPER_BIN" config agents list
"$FOOL_HELPER_BIN" config providers list
"$FOOL_HELPER_BIN" config mcp servers list
```

What this installation can actually reach: the skills available to an assistant,
the agents that can run, the model providers configured, the MCP servers
connected.

For the full configuration surface — creating and editing assistants, writing
assistant rules, importing skills, themes, scheduled tasks, kanban — use the
`fool-config` skill. It is the reference; this one is the orientation.

## What the app is

A desktop application that runs AI agents against a workspace, plus the
surfaces around that. When the user names one of these, they mean:

- **Assistants** — named configurations: a rule file, a set of skills, a model.
  The one answering right now is in `config context`. `fool-config` covers
  creating and changing them, including the timing caveat that a change does not
  reach a conversation already running.
- **Agents** — the runtimes an assistant can be backed by. `config agents list`.
- **Skills** — what an assistant knows how to do. Built-in skills ship with the
  app; some are shared with every assistant automatically and the rest are
  switched on per assistant. `config skills list`.
- **MCP servers** — tools from outside the app. `config mcp servers list`.
- **Providers and models** — where the intelligence comes from, including which
  models accept images. `config providers list`.
- **Workspace** — the directory an agent reads and writes. Per conversation.
- **Voice** — hold the right Ctrl key to talk; a notch appears at the top of the
  screen showing what is being heard and what is being said back. Two quick taps
  on the same key capture a region of the screen into the composer instead.
  Settings live under the voice section of client preferences.
- **The pet** — the desktop companion window, with its own poses and menu.
- **Scheduled tasks** — recurring work. See the `cron` skill and
  `config capabilities`.
- **Teams** — several assistants working together on one task.
- **WebUI** — reaching this installation from another device on the network.
- **Kanban** — the board. `config capabilities` lists its commands.

If the user names something that is not in this list, that is not evidence it
does not exist — it is evidence this list is older than the feature. Go back to
`config capabilities` and the settings.

## When something did not work

Diagnose from the app, not from a guess about it:

1. `config context` — is the assistant, model and workspace what the user thinks?
2. `config providers health-check` — is the model reachable at all?
3. The `fool-troubleshooting` skill, for the failures that have known shapes.

Report what you found, plainly. If a step failed, say which one and what it
said, rather than describing the whole thing as "an error".

## Answering well

- The user is looking at the app. Point at what they can see — the screen, the
  toggle, the menu item — before offering to do it for them.
- You can usually just do it. Changing a setting, adding a provider, writing an
  assistant rule are all one command away in `fool-config`. Offer.
- Read back after writing, and say whether the change is live now or applies to
  the next conversation. `fool-config` is explicit about which is which.
- Never show internal ids, and never reveal provider keys, MCP headers or
  environment values.
