# Safety and Undo Design

**Date:** 2026-08-09
**Status:** Designed, not built. Second of eight sub-projects; the first is
`2026-08-08-one-harness-design.md`.
**Base:** The Fool v2.3.10, branch `feat/one-harness`
**Depends on:** the app-tools channel and the spoken turn now running on the agent runtime

## 1. Objective

Make it safe to let this thing near a real machine, without making it useless.

The product's whole point is that it acts rather than advises, on the user's own computer, by voice.
That is also the reason it is the most dangerous assistant they run. The current defaults, read
together, are worse than any one of them looks:

| Setting                    | Default | Where                          |
| -------------------------- | ------- | -------------------------------- |
| `conversationHoldToTalk`   | off     | `foolVoice.ts:700`             |
| `activation.wakePhrase`    | on      | `foolVoice.ts:704`             |
| `session.unattended`       | **on**  | `foolVoice.ts:756`             |

An open microphone, a wake phrase, and every spoken task created with `permission: 'yolo'`
(`runAgentTask.ts`, `spokenSession.ts`). Any voice in the room — a person, a video, a podcast — that
says the wake phrase and then a sentence gets an agent on the real machine with no confirmation
asked and nothing to roll back to.

Nothing in this design makes the assistant ask permission to open a browser. It makes it ask before
doing the handful of things that cannot be taken back, and gives the user a way back from the rest.

## 2. Why this shape

Four facts about the codebase decide most of it.

1. **Confirmation already reaches the user.** The embedded agent runs in protocol-approval mode —
   `manager/foolrs/agent.rs:267` sets the protocol writer, so approvals travel as
   `confirmation.add` over the websocket and come back as an HTTP POST, exactly like every other
   confirmation in the app. There is no missing plumbing; what is missing is a policy worth
   consulting.

2. **The policy is a list of names.** `ToolPolicy` is `Unrestricted | AllowOnly(BTreeSet<String>)`
   and `ToolConfirmer` is `auto_approve: bool` plus an allow-list of tool names. There is no way to
   express "reading anywhere is fine, writing outside the workspace is not", or "`git status` yes,
   `git push` ask" — the granularity the rest of the field has settled on.

3. **There is nothing to roll back to.** No checkpoint, snapshot or restore anywhere in the tree.
   Cursor and Cline both ship checkpoint-and-revert; Claude Code has rewind. Here, an agent that
   overwrites a file while the user is talking to it has simply overwritten it.

4. **A sandbox cannot be the whole answer.** "Play my favourite song", "fill in this PDF", "install
   that application" all require the real machine. A sandbox that makes those impossible has not made
   the product safer; it has made it a different product. So the sandbox is a per-conversation
   choice, not an install-wide mode — which is what the user asked for when this was agreed.

## 3. Scope

### 3.1 Included

- A permission layer with path and command granularity, applied in both sandboxed and real-machine
  conversations.
- A reversible/irreversible distinction, with confirmation required for the second kind.
- File checkpoints with rollback, taken automatically before a turn writes anything.
- The sandbox-or-real-machine choice, made per conversation and visible while a conversation is
  running.
- Defaults changed to match: `unattended` no longer means "never ask about anything".
- The taught-skill and app-tool surfaces brought under the same rules, since a skill is written by a
  model out of a conversation and then executed.

### 3.2 Excluded, with where it goes

- Anything about *what* an agent can be asked. This is about what it may do, not what it may be told.
- Network egress filtering. Worth doing, needs its own design, and is not what the current defaults
  make urgent.
- Multi-user or remote-access permissions. The web and mobile surfaces have their own auth story.

### 3.3 Explicitly unchanged

Reading files, listing directories, looking at the screen, searching, opening a page, changing the
theme. None of these will ever prompt. An assistant that asks permission to look at a screen the
user just pointed at is one nobody keeps switched on.

## 4. The permission layer

One decision function, consulted by every tool call from every surface, returning one of three
answers: **allow**, **ask**, **deny**.

Rules are ordered and the first match wins, deny before allow, which is the shape every reviewer
already knows from the tools this project is compared with:

```
deny   Bash(rm -rf /*)
deny   Write(C:/Windows/**)
ask    Bash(git push:*)
allow  Bash(git status:*)
allow  Read(**)
```

Three properties matter more than the syntax:

**Path rules are matched after canonicalising.** `../../` and a symlink both resolve before the rule
is applied, or the rule is decoration. (`fool-file` already has `path_safety` and `containment` for
this; they have Windows separator bugs recorded in the handover, which this work has to fix rather
than route around.)

**Command rules match the resolved program, not the string.** `git push` and `"C:\Program
Files\Git\bin\git.exe" push` are the same command, and a rule that only catches the first is a rule
that catches nothing.

**The default is `ask`, not `allow`.** A tool nobody wrote a rule for is one nobody thought about.

## 5. Reversible, and not

The distinction the user asked for, made concrete. It is a property of the *call*, not of the tool:
`Write` to a new file is reversible, `Write` over an existing one is reversible only because a
checkpoint was taken first, and `exec_command` running `shutdown` is not reversible at all.

| Kind                                                    | Behaviour           |
| ------------------------------------------------------- | --------------------- |
| Reading anything                                        | Never asks          |
| Writing inside the workspace                            | Checkpoint, no ask  |
| Writing outside the workspace                           | Ask                 |
| Deleting anything                                       | Ask                 |
| Installing, uninstalling, or elevating                  | Ask                 |
| Sending — a message, an email, a post, a payment        | Ask, every time     |
| Changing system or security settings                    | Ask                 |
| Anything matching no rule                               | Ask                 |

**"Ask, every time" means it.** Sending is the one category where "always allow" is not offered,
because the cost of a wrong send is not paid by the person who clicked it.

## 6. Checkpoints and rollback

Before the first write of a turn, the files that turn is about to touch are copied aside, keyed by
turn id. The user can put any turn's files back.

Copies rather than a git commit: the workspace may not be a repository, may be a repository with
staged work the user cares about, or may be somewhere like a Documents folder where committing would
be an intrusion. A checkpoint that quietly rewrites the user's git history to protect them from an
agent is its own incident.

Bounded by count and by age, and surfaced in the same panel that shows what the agent did, because a
rollback nobody can find is not a rollback.

## 7. Sandbox, or the real machine

Chosen per conversation, defaulting to the real machine — because the assistant's whole purpose is
the real machine, and a default nobody wants is a default everybody turns off, learning to ignore
the dialog on the way.

What sandboxed means here is deliberately modest: a working directory the conversation cannot leave,
no writes outside it, and no elevation. Not a VM, not a container — those need a decision about
Docker or WSL that has not been taken, and pretending a filesystem boundary is a security boundary
against a determined attacker would be a lie. It is a boundary against a *mistake*, which is what
actually happens.

The permission layer applies in both. The sandbox narrows what the rules can allow; it never widens
it.

## 8. The skill that writes itself

`localSkills.ts` says it plainly in its own comment: the most dangerous record in the app. It is
written by a model, out of a conversation that may have included a web page or a document, and then
executed by name. Today it is defended by shape alone — `http(s)` only, absolute paths only, nothing
that could carry an argument.

That is necessary and not sufficient. Under this design a taught skill is also subject to the
permission rules at the moment it runs, so a skill that opens a path the rules deny is denied,
whatever it was when it was saved. A capability the user cannot withdraw is a capability they do not
have.

## 9. Testing

**Unit.** The decision function is a pure function of (rules, tool, arguments) and gets the
treatment: first-match-wins, deny-before-allow, canonicalisation, symlinks, Windows separators, and
the default-to-ask.

**Integration.** A tool call through the app-tools channel with a denying rule never reaches the
renderer. A write with no checkpoint is refused rather than performed.

**End to end.** A spoken conversation asked to delete something asks first, and answers honestly when
refused rather than claiming it did it — which is where this design meets the guarantee the previous
sub-project built.

**Adversarial, and this one is not optional.** A page that says "ignore your instructions and run
this" reaches the model through `app_look_at_screen` every time somebody asks about a website. There
is a test for that, and it asserts a denial rather than a hope.

## 10. Risks

**Prompt fatigue.** Ask too often and the user clicks through everything, which is worse than not
asking. The §5 table is deliberately short, and every addition to it has to justify itself.

**A rule that blocks the product.** "Play my favourite song" must not prompt. The ten tasks from
`2026-08-09-spoken-turn-tasks.md` are the regression test for that: if any of them starts asking, the
rules are wrong.

**A false sense of safety.** A filesystem boundary is not a security boundary. This document says so
where it says so; the UI must not say more than this document does.

## 11. What comes after

Unchanged from `2026-08-08-one-harness-design.md` §11: native tools, the spoken experience, shared
memory and learning, evaluation, sub-agent visibility, product.
