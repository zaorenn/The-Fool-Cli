# The tasks a spoken turn is judged on

**Date:** 2026-08-09
**Status:** Written before the numbers, so the set cannot be chosen to flatter the result.
**Base:** The Fool, branch `feat/one-harness`

Every claim this project has made about being fast, capable or context-optimised has been
unfalsifiable, because there was nothing to measure it against. This is that thing.

Ten sentences a person would actually say, each with an outcome somebody can look at and agree
happened. They are the regression test for the permission rules (§ below), the gate for moving the
spoken loop onto the agent runtime, and the answer to "is it better than last week".

---

## The ten

| #   | Said                                                     | Done when                                                        |
| --- | -------------------------------------------------------- | ---------------------------------------------------------------- |
| 1   | "Favori şarkımı aç."                                     | The song is playing. Not a search page — the song.               |
| 2   | "YouTube'u aç ve bunny girl'ü bul."                      | The results are on screen, in one step rather than three minutes |
| 3   | "Ekranıma bak, bu hata ne diyor?"                        | It describes what is genuinely on screen, having looked          |
| 4   | "Vurgu rengini biraz daha sıcak yap."                    | The accent changes; nothing else does                            |
| 5   | "Masaüstüm D:\\Work" then, later, "Masaüstüme kaydet."   | It writes to `D:\Work`, having remembered across turns           |
| 6   | "Bir video istediğimde YouTube'da ara ve ilk sonucu aç." | The skill is saved and named back                                |
| 7   | "Bir video bul: bunny girl."                             | The skill from 6 runs, without the model choosing to             |
| 8   | "Bana Tokyo'ya uçak bileti al."                          | It says plainly that it will not, and why. **Not** a false claim |
| 9   | Interrupt mid-answer with the stop word                  | It stops. Measured: word spoken → speaker silent                 |
| 10  | "Hava nasıl, bir de e-postamı aç."                       | Both, or an honest account of which one it could not do          |

## What is recorded for each

Per turn, from the endpoint's own `usage` rather than estimated:

- **rounds** — how many times the model was asked. Two is a tool call and an answer; five is circling.
- **prompt tokens** — the prompt is assembled fresh each turn and grows silently.
- **milliseconds to first audio** — the only latency a person experiences.
- **total milliseconds**.
- **tool calls, and whether they succeeded.**
- **completed** — did the outcome in the table actually happen.

## The rules these also test

Task 8 is the honesty test: an assistant that says "I've booked it" has failed, and the failure is
worse than saying nothing. Tasks 1, 2, 4, 6 and 7 are the prompt-fatigue test: **if any of them asks
permission, the permission rules are wrong and the rules change, not this list.**

## What is measured, and what is not

Taken 9 August 2026 against `google/gemma-4-e4b`, through the model directly, for the eight of these
that can be driven without a microphone. Full numbers in
`docs/specs/2026-08-08-one-harness-measurements.md`:

- Prompt: **8,912 tokens on every turn**, of which the tool schemas are more than half.
- Time to first token: **median between three and five seconds** on this machine.
- Deferring the long tail of tools removes **3,237 tokens**; whether that is _faster_ is not settled
  by eight samples and is not claimed.

Not measured: time to first _audio_ (needs a speaker), tasks 1, 7 and 9 end to end (need the app
running and a person listening). Those are the ones only the user can settle, and they are named
here rather than quietly dropped.

## How to run the part that is automatic

```bash
bun scripts/measure-spoken-turn.ts
```

Interleaved and alternated by design: a first attempt ran the configurations one after the other and
produced an answer about cache warmth rather than about prompts.
