---
name: fool-app
description: >-
  What The Fool is, what it can do, and how to do any of it for the user — features, settings, themes, skills, MCP servers, browsing, and anything they could have reached themselves. Use whenever the question is about the application rather than about the user's own work: how to turn something on, where a screen is, what a control does, why something did not happen, or anything beginning "can The Fool…". Use it before telling a user the app cannot do something, and use it whenever they ask you to change, install, find or set up anything about the app itself.
---

# The Fool

You are running inside The Fool, and the user is talking to you _in_ the thing
they are asking about. That is an advantage no documentation has: you can look,
and you can act.

## Two rules

**Never answer about this app from memory.** It changes faster than any file
inside it. Everything below is a map to a live source, not a copy of one. Before
saying what the app does, ask it — the commands in the next section report what
_this_ build supports, so a feature added after this file was written still
shows up.

**Never say the app cannot do something without checking.** "The Fool can't do
that" is the one answer that stops the user trying, so it is the one that has to
be earned. Run the discovery commands first.

## Do it, don't describe it

Anything the user can reach through the interface, you can do for them. That is
the point of this skill. When someone says "make it green", "add a browser
tool", "find me a skill for X" — do it, then tell them what you did and what
they will see.

Three things to get right every time:

1. **Read before writing, and read back afterwards.** `settings client put`
   upserts the keys you give it, so an ordinary write is small — but a value like
   `theme.userThemes` is an array you must read, modify and write back whole, or
   you will drop everything else in it.
2. **Say when it takes effect.** Assistant changes apply to new conversations,
   not the one you are in. Do not let the user think a change has landed when it
   has not.
3. **Never reveal provider keys, MCP headers or environment values**, and do not
   show internal ids unless the user needs one for a follow-up.

The full command reference is the **`fool-config`** skill, which is always
available. This file says what is possible and where to start; that one says
exactly how, with the JSON for each command.

## Ask the app what it can do

```bash
"$FOOL_HELPER_BIN" config capabilities
```

Every configuration domain and command this build has, with the fields each one
takes. This is the part that stays current on its own — a newly configurable
feature appears here without anyone editing a skill. Read it when you are unsure
whether something is possible.

```bash
"$FOOL_HELPER_BIN" config context
```

Who the user is, which conversation this is, which assistant is answering, and
what the local runtime looks like. Read it before saying anything about "your
setup".

```bash
"$FOOL_HELPER_BIN" config settings client get
```

Everything the user can see and change in the interface, as it is right now.
When someone asks "where do I turn X on", the key is usually already here — and
its absence is evidence too.

```bash
"$FOOL_HELPER_BIN" config skills list
"$FOOL_HELPER_BIN" config agents list
"$FOOL_HELPER_BIN" config providers list
"$FOOL_HELPER_BIN" config mcp servers list
```

What this installation can actually reach.

## Themes — build one, apply it, delete it

Themes live in client preferences; there is no separate theme command.

- **A colour, not a theme.** "Make it green" is one write to
  `ui.themeOverrides`, which sits on top of the active theme. Do not build a
  theme object for a colour change. Writing `null` there drops every override.
- **A theme to keep.** Read `theme.userThemes`, append your object, write the
  whole array back, and set `theme.activeId` to switch to it. Adding without
  setting `activeId` only makes it available to pick.
- **Deleting one.** The same shape in reverse: read the array, write it back
  without that entry. If the theme being deleted is the active one, set
  `theme.activeId` in the same write to something that still exists — otherwise
  the user is left pointing at a theme that is gone.
- Built-in themes are shipped by the app. Never write them into
  `theme.userThemes`, and never set `builtin: true` on anything you create.

### A theme must not be able to hide the app

Theme `css` is injected with `!important` added to **every** declaration, so it
outranks the application's own styles. That is what makes theming work, and it
is also how a theme can blank the window — and the settings screen that would
undo it goes with it, leaving the user nothing to click.

So never write, at `html`, `body`, `*`, `:root`, `#root` or `#app`:

- `display: none`
- `visibility: hidden`
- `opacity: 0`
- `transform: scale(0)`

Hiding one of your own components is fine; it is only the document-level
selectors that take the whole interface with them. Two more habits that keep a
theme safe:

- **Set a foreground whenever you set a background.** A theme that paints the
  background without changing the text colour is how a window ends up white on
  white or black on black — readable to nobody, and not obviously "broken"
  either.
- **Prefer the colour variables to blanket rules.** Restyling `:root` custom
  properties reaches the whole app without fighting its layout.

The app carries a safety net that forces `html` and `body` back into view after
every theme, so a mistake here is survivable — but it is a net, not a licence.
If the user does end up looking at a blank or unreadable window, tell them:
**right-click the tray icon and choose "Reset theme"**, which restores the
default appearance and clears every colour override without deleting the themes
they have made.

`fool-config` has the exact JSON, the required fields, and the built-in ids.

## MCP servers — find them, then add them

You are not limited to the servers the user already knows about. If they ask for
a capability the app does not have, go and find one.

1. **Search.** You have a shell. `curl` the MCP registries, a project's README,
   the vendor's own documentation. What you need from it is the transport: a
   command with arguments and environment, or a URL for an HTTP server.
2. **Check what is there** with `config mcp servers list`, so you do not add a
   second copy of something already installed.
3. **Add it** with `config mcp servers create`, then run
   `config mcp test-connection` before telling the user it works. Configured and
   unreachable is not installed.
4. **Attach it** to the assistant that needs it, and say whether it applies now
   or to the next conversation.

Two things to be careful about, because this reaches outside the machine:

- **Ask before adding anything that needs a credential**, and never invent or
  guess one. The user supplies keys; you never print them back.
- **Say what a server will be able to do** before adding it. An MCP server is
  code that runs on their machine, and the user is entitled to know that before
  it does.

## The browser

The app ships a **chrome-devtools** MCP server for real browsing — navigating
pages, reading them, filling forms. It is switched off until the user turns it
on, and it needs `npx` available on the machine.

Look for it in `config mcp servers list`. If the user wants you to browse and it
is disabled, say so and offer to enable it — do not report that you cannot
browse. Once it is enabled and attached, its tools appear alongside your own and
you call them directly.

For simply fetching what a page says, rather than driving a browser, `curl`
through the shell is usually enough and needs nothing switched on.

## Skills — find them and install them

Skills are what an assistant knows how to do, and you can go and get new ones.

1. **See what is installed** — `config skills list`, and `config skills info` to
   inspect a directory before importing it.
2. **Find one.** A skill is a directory containing a `SKILL.md`. They come from
   skill repositories, from a project's own documentation, or as a zip. Use the
   shell to search and download — `curl -L` a release zip to a temporary path.
3. **Import it** with `config skills import`, pointing at the directory, its
   parent, or the zip.
4. **Attach it** with `config assistants update`. Read the assistant first and
   send the full intended `enabled_skills` list — the value replaces the old one,
   so appending blindly loses the rest.
5. **Write one** if none exists. The `skill-creator` skill is always available
   and is the right tool for that.

`config skills market enable` switches on a browsable source inside the app.

## What the app is

When the user names one of these, they mean:

- **Assistants** — named configurations: a rule file, a set of skills, a model.
  The one answering right now is in `config context`.
- **Agents** — the runtimes an assistant can be backed by.
- **Skills** — see above. Some are shared with every assistant automatically;
  the rest are switched on per assistant.
- **MCP servers** — tools from outside the app. See above.
- **Providers and models** — where the intelligence comes from, including which
  models accept images.
- **Workspace** — the directory an agent reads and writes, per conversation.
- **Voice** — hold the right Ctrl key to talk; a notch at the top of the screen
  shows what is being heard and what is being said back. Two quick taps on the
  same key capture a region of the screen into the composer instead.
- **The pet** — the desktop companion window, with its own poses and menu.
- **Scheduled tasks** — recurring work; see the `cron` skill.
- **Teams** — several assistants working on one task together.
- **WebUI** — reaching this installation from another device on the network.
- **Kanban** — the board.

If the user names something that is not in this list, that is not evidence it
does not exist — it is evidence that this list is older than the feature. Go back
to `config capabilities` and to the settings.

## When something did not work

Diagnose from the app, not from a guess about it:

1. `config context` — are the assistant, model and workspace what they think?
2. `config providers health-check` — is the model reachable at all?
3. The `fool-troubleshooting` skill, for the failures that have a known shape.

Report what you found. If a step failed, say which one and what it said, rather
than calling the whole thing "an error". If the CLI fails, quote the stable
`CONFIG_...` error from stderr and do not claim the change was made.
