# The ten spoken tasks

**Date:** 2026-08-09
**Purpose:** the set the harness move is judged on, written **before** it is run so it cannot be
chosen to flatter the result.
**Model:** `gemma-4-e4b`, the local model this product claims to run well on 8 GB of VRAM.

Each is a sentence a person would actually say, with an outcome somebody watching the screen can
agree or disagree with. None of them is a benchmark prompt; all of them come from things this
project has already been reported failing at.

| #  | Said out loud                                          | What counts as done                                              |
| -- | -------------------------------------------------------- | ------------------------------------------------------------------ |
| 1  | "Play my favourite song."                                | The song is playing. Not a page about it, not a claim about it.  |
| 2  | "Open YouTube and find *bunny girl*."                    | A results page for that query is in front of the user.           |
| 3  | "Look at my screen and tell me what this error says."    | The answer matches text actually on the screen.                  |
| 4  | "Make the accent colour warmer."                         | The accent changes; nothing else does.                           |
| 5  | "My desktop is D:\\Work. Where is my desktop?" *(next turn)* | The second answer says `D:\Work` without being told again.  |
| 6  | "When I ask for a video, search YouTube and open the first result." | The skill is saved and listed in settings.            |
| 7  | "Do that video thing for *lofi*." *(uses the skill from 6)* | It runs the taught skill rather than asking the agent.        |
| 8  | "Book me a flight to Tokyo."                             | It says plainly that it cannot, **after** trying. Never a false claim. |
| 9  | Interrupt mid-answer with the stop word.                 | Speech stops, and the model stops generating.                    |
| 10 | "What's the weather, and also open my email."            | Both are answered or done; neither is silently dropped.          |

## What is recorded per turn

Taken from the turn itself, not estimated:

| Figure                | Source                                                                 |
| --------------------- | ------------------------------------------------------------------------ |
| Rounds                | How many times the model was asked. Two is a tool call and an answer.   |
| Prompt tokens         | The endpoint's own `usage.prompt_tokens`. Not characters.              |
| Time to first audio   | The only latency a person experiences.                                 |
| Total time            | For the bill at the end.                                               |
| Tool calls            | A turn that did real work is allowed to be slower.                     |
| Completed             | Yes or no, judged against the middle column above.                     |

## The gate

The flag in `realtime.useAgentRuntime` opens only if, across these ten:

- the **median time to first audio** is no worse than with the flag off;
- the **round count** has not risen;
- the **completion rate** has not fallen.

If any of the three regresses, the regression is the next piece of work and the flag stays shut. A
flag that opens on an argument rather than a number is how the slower path ships.

## What cannot be measured without a person

Tasks 1 to 10 are spoken, and **time to first audio requires a microphone and a speaker**. Nobody
can honestly record that from a script. What *can* be taken headlessly — by sending the same ten
sentences to the same conversation over the API — is rounds, prompt tokens, tool calls, total time,
and whether the outcome happened. Those are recorded separately and marked as such, because a number
taken a different way is a different number.
