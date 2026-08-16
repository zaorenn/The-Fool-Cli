# Hermes, enumerated — and how to reach everything it can do

Written 16 August 2026. This replaces the "enumerate first, do not guess" step
in `2.6.0-sub-chats-and-document-awareness.md`. The enumeration has been done,
against the installed agent, not from memory.

## What was inspected

**Hermes Agent v0.19.0 (2026.7.20)**, a git install with full source at
`C:\Users\sarhen\AppData\Local\hermes\hermes-agent`, Python venv at
`venv/Scripts/hermes`.

Reproduce any of this:

```bash
H="$LOCALAPPDATA/hermes/hermes-agent"
"$H/venv/Scripts/hermes" --version
"$H/venv/Scripts/hermes" tools list
cd "$H" && ./venv/Scripts/python -c "import sys;sys.path.insert(0,'.');from toolsets import TOOLSETS;print(len(TOOLSETS))"
```

## The numbers

|                                                 |        |
| ----------------------------------------------- | ------ |
| Toolsets defined (`toolsets.py`)                | **57** |
| Unique tools across all of them                 | **81** |
| Tools the **CLI** gets (`hermes-cli`)           | **54** |
| Tools **The Fool** gets over ACP (`hermes-acp`) | **29** |
| Subcommands on the binary                       | ~60    |

**The Fool currently sees 29 of 81.** That is the headline. Hermes is not
missing the capabilities we want; the door we come through is narrower than the
one its own CLI uses.

## The three tiers of gap

### Tier 1 — Hermes has it, the CLI gets it, ACP does not (25 tools)

```
clarify          computer_use     cronjob          close_terminal
focus_pane       image_generate   open_preview     read_terminal
text_to_speech
ha_list_entities ha_get_state     ha_list_services ha_call_service
kanban_show      kanban_list      kanban_create    kanban_complete
kanban_block     kanban_unblock   kanban_comment   kanban_link
kanban_heartbeat kanban_attach    kanban_attach_url kanban_attachments
```

Note `computer_use` and `image_generate` in that list: The Fool has its own
versions of both, so those are duplicates rather than gaps. `open_preview`,
`read_terminal` and `clarify` are the interesting ones — Hermes can show the
user a document and ask a clarifying question, and over ACP it cannot.

### Tier 2 — Hermes has it and **no** distribution ships it (15 tools)

```
video_analyze                          ← watching a video
video_generate  xai_video_edit  xai_video_extend
spotify_playback  spotify_devices  spotify_queue  spotify_search
spotify_playlists spotify_albums   spotify_library
project_list      project_create   project_switch
x_search
```

**Both things asked for this week are in this tier.** They are written, they
work, and nothing can reach them — the same "written, tested, never wired"
shape this project keeps finding in its own code, one process away.

- **"YouTube videosunu izleyip özetlesin"** → `video_analyze`. Its real schema:

  ```
  video_analyze(video_url, question)
    "Analyze a video from a URL or local file path using a multimodal AI model.
     Sends the video to a video-capable model (e.g. Gemini) for understanding.
     Supports mp4, webm, mov, avi, mkv, mpeg. Large videos (>20 MB) may be
     slow; max ~50 MB."
  ```

  Note the limit: this takes a **video file**, not a YouTube page. A watch-and-
  summarise flow still needs the fetch step in front of it, and the ~50 MB
  ceiling means a long video must be captioned or chunked rather than uploaded.
  The plan in `2.6.0-…` (captions first, local Whisper second) remains correct;
  `video_analyze` is the third route, for when the picture matters.

- **Spotify** → a whole toolset, seven tools, far past what we built:

  ```
  spotify_playback(action=get_state|get_currently_playing|play|pause|next|
                          previous|seek|set_repeat|set_shuffle|set_volume|
                          recently_played, device_id, uris, position_ms, …)
  spotify_devices(action=list|transfer, device_id, play)
  spotify_search / spotify_queue / spotify_playlists / spotify_albums /
  spotify_library
  ```

  `spotify_devices(action="transfer")` is exactly the recovery we hand-wrote in
  `playOnSpotify` for 2.6.0 — Hermes had it already. Ours stays (it is on the
  fast path and needs no subprocess), but this is the shape of the waste.

### Tier 3 — the ~60 subcommands

`cron`, `webhook`, `kanban`, `memory-graph`, `learning`, `journey`, `skills`,
`bundles`, `plugins`, `lsp`, `proxy`, `gateway`, `slack`/`discord`/`whatsapp`/
`signal`/`matrix`/`telegram`, `computer-use`, `desktop`, `serve`, `dashboard`,
`insights`, `checkpoints`, `backup`, `security`, `approvals`, `doctor`.

These are not tools the model calls; they are surfaces Hermes exposes. Most are
out of scope. `skills`, `memory`, `cron` and `kanban` overlap things The Fool
already has and should **not** be duplicated.

## How to actually reach them

`hermes-acp` takes no toolset flag — checked in `acp_adapter/entry.py`, whose
arguments are only `--version --check --setup --setup-browser --yes`. So the
lever is not the command line.

It is here, in `acp_adapter/session.py` and `server.py`:

```python
_expand_acp_enabled_toolsets(
    getattr(state.agent, "enabled_toolsets", None) or ["hermes-acp"],
    mcp_server_names,
)
```

### The config lever was tested and it does not exist

**Run 16 Aug 2026, and it falsified the first draft of this document.**
`hermes tools enable video` succeeded and wrote `platform_toolsets.cli` in
`%LOCALAPPDATA%\hermes\config.yaml`. It changed nothing for ACP, because
`acp_adapter/session.py::_make_agent` builds the agent like this:

```python
kwargs = {
    "platform": "acp",
    "enabled_toolsets": _expand_acp_enabled_toolsets(
        ["hermes-acp"],                      # ← a literal, not config
        mcp_server_names=configured_mcp_servers,
    ),
    ...
}
```

It reads `config.get("model")` and `config.get("mcp_servers")` from the same
`load_config()` call and **never reads `platform_toolsets`** or any ACP toolset
key. Nothing in `acp_adapter/` references `resolve_toolset` or
`platform_toolsets` at all. So there is no configuration that widens the ACP
surface, and `hermes tools enable` is a CLI-only switch.

That leaves three real routes, in order of cost:

1. **MCP, the one path that does work.** `configured_mcp_servers` is read from
   config and each becomes an `mcp-<name>` toolset on the ACP session. So
   anything exposed as an MCP server reaches Hermes-over-ACP with no patch. This
   is how to give Hermes _our_ capabilities, and it is free.
2. **A three-line patch to `_make_agent`**, reading `platform_toolsets.acp`
   with `["hermes-acp"]` as the fallback. This install is already a git
   checkout carrying one local commit (`local 01cb38e8 (+1 carried commit)`),
   so carrying a second is an established practice here rather than a new one.
   It unlocks all 81 tools and is worth proposing upstream, since the ACP
   surface being narrower than the CLI's looks like an oversight rather than a
   decision.
3. **Call the `hermes` binary directly** for one capability at a time
   (`hermes -t video -z "…"`). No patch, no ACP, but a separate process and a
   separate session per call — worth it only for something rare and heavy.

**Route 2 is the recommendation**, with route 1 done first because it costs
nothing and is needed regardless.

## Steps

1. ~~**Prove the lever before building on it.**~~ **Done — it failed.** See
   above: `_make_agent` hard-codes `["hermes-acp"]`. Kept here rather than
   deleted, because the next person will otherwise have the same idea and spend
   the same hour on it.

   Replacement first step: **patch `_make_agent`** to read
   `platform_toolsets.acp` from the config it already loads, defaulting to
   `["hermes-acp"]`. Then re-run the count. The patch lives in the Hermes
   checkout, not this repo, so record it in `docs/` here and keep it applied
   across `hermes update`.

2. **Decide the toolset per surface, deliberately.** Do not enable all 81.
   `REALTIME_TOOLS` is short on purpose — every entry is a pause in a spoken
   conversation. Proposal: the spoken assistant keeps its short list and
   delegates; the _chat_ agent gets the wide one.

3. **Enable, in this order, by what was actually asked for.**
   - `video` → `video_analyze`, behind the caption/Whisper flow.
   - `spotify` → all seven. Then reconsider whether our `playOnSpotify` wake
     path should defer to `spotify_devices(transfer)`.
   - `clarify` → Hermes asking the user a question mid-task, which is the
     "bu mu?" confirmation step by another name.
   - `open_preview` → route it into our own viewer rather than its own.

4. **Route, do not reimplement.** Kanban, cron, memory and skills all exist on
   both sides. Every one of those we build again is a second thing to keep
   working. The rule from 2.6.0 applies: build the tool, do not prompt the
   model — and delegating _is_ building the tool.

5. **Write the parity table down and keep it.** 81 tools, one row each:
   _ours_ / _delegate_ / _deliberately not_. A capability list nobody maintains
   is how we got here.

## Measured: 81 is a catalogue, 26 is the reality

Calling Hermes's own registry directly on this machine —

```bash
cd "$LOCALAPPDATA/hermes/hermes-agent" && ./venv/Scripts/python -c \
 "import sys;sys.path.insert(0,'.');from model_tools import get_tool_definitions;\
  print(len(get_tool_definitions(enabled_toolsets=['hermes-cli','video','spotify'],quiet_mode=True)))"
```

— returns **26**, not 54 and not 81, and prints why:

```
check_fn check_vision_requirements returned False; dependent tools will be unavailable this turn
check_fn check_web_api_key returned False; dependent tools will be unavailable this turn
```

`video_analyze` and `spotify_playback` are **absent even with their toolsets
explicitly requested**. Tool availability is gated per turn on credentials, not
only on configuration. So the parity target is not "81 tools" — it is "26 today,
and each further tool costs a credential someone has to supply".

This reorders the whole plan. Widening the ACP surface (the `_make_agent` patch)
buys far less than it appears to until the keys exist: a Gemini-class video
model, Spotify OAuth, a web-search API key, an X account. **Get one credential
and verify one tool end to end before patching anything.**

Also observed in the same run: `openrouter.ai` failed with
`CERTIFICATE_VERIFY_FAILED — unable to get local issuer certificate`. That is
the same TLS-interception problem this machine has hit before with Java. Hermes
will silently mark providers unhealthy and drop tools because of it, which looks
identical to a missing feature.

## Should Hermes replace the backend entirely?

Raised 16 Aug: use Hermes as the agent rather than The Fool's own runtime,
since its agentic infrastructure is stronger, and adapt it to voice mode.

It is a serious option and the argument for it is real — Hermes has the loop,
the skills, delegation, checkpoints, provider fallback and MoA that we would
otherwise rebuild. But it must be settled by measurement rather than by
preference, and there is exactly one number that decides it:

**Time to the first spoken word.** The voice mode is built around it —
`REALTIME_TOOLS` is deliberately short because "every entry is a pause in the
conversation", the local model answers in ~0.6 s, and reasoning is switched off
to reach 177 ms. Hermes is a Python agent with a cold start, a large tool prompt
and its own provider resolution. If a spoken turn through Hermes cannot reach
the first word in about a second, the trade is not worth making for voice
however much capability it adds.

The eval harness already times the first spoken word. So:

1. Run the existing eval against the current path. Record first-word latency.
2. Route one spoken turn through Hermes-over-ACP. Record the same number.
3. Compare, then decide — and the answer may legitimately be **both**: Hermes
   behind the chat agent where minutes are acceptable, the current runtime in
   front of the microphone where they are not.

What must not happen is switching the backend and discovering the latency
afterwards. That is the same mistake as every fault in 2.5.9 and 2.6.0: a change
that looks right and was never watched running.

## What will go wrong

- **Token budget.** 54 tool schemas in a prompt is a large fixed cost every
  turn, and a measured experiment on this project already showed a 9B model
  losing capability when the tool list was manipulated to save tokens (deferred
  tool loading: 4,493 tokens a turn saved, two capabilities lost). Enabling
  everything for the voice path would be the same mistake in the other
  direction. Measure the prompt size (`hermes prompt-size` exists) before and
  after.
- **`enabled_toolsets` is global to Hermes.** It is that install's config, not
  per-caller. If the user runs `hermes` in a terminal themselves, this changes
  what they get too.
- **Tier 2 tools are disabled for a reason worth checking.** `video`, `spotify`,
  `x_search` and `video_gen` are all off by default in `hermes tools list`.
  Several need their own credentials — Spotify OAuth, a video-capable model
  (Gemini), an X account. Enabling the toolset does not supply the key, and a
  tool that is advertised and cannot authenticate is worse than one that is
  absent: the model will keep trying it.
- **Version drift.** All of this is v0.19.0 (2026.7.20). It is a git install
  that updates. Re-run the enumeration after any `hermes update`.
