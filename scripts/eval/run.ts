/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Run the tasks and say how many passed, and how long the silence was.
 *
 * Every claim this project has made about being capable was unfalsifiable
 * because there was nothing that ran the list. This runs it: the same persona
 * and the same tools a spoken conversation advertises, and a verdict from
 * `tasks.ts` — which is pure, and tested.
 *
 *   bun scripts/eval/run.ts
 *   bun scripts/eval/run.ts --endpoint http://127.0.0.1:1234/v1 --model qwen/qwen3.5-9b
 *   bun scripts/eval/run.ts --min-score 12       # non-zero exit below the floor
 *   bun scripts/eval/run.ts --only 13,14         # one task while working on it
 *   bun scripts/eval/run.ts --repeat 3           # a flaky task is not a passing one
 *   bun scripts/eval/run.ts --json               # one object, for a chart later
 *
 * It needs a model endpoint. Without one it says so and exits non-zero rather
 * than reporting a score of zero, which would look like a regression.
 *
 * ## Two things this does that the first version did not
 *
 * **It holds a conversation.** Tasks 11 onward are several turns with the tool
 * results written down beside them, because the complaint the harness could not
 * see — that the assistant is worse in a conversation than the model is on its
 * own — lives entirely in the turns a single-turn runner never takes.
 *
 * **It streams, and times the first word.** Half of what people report is not
 * about the answer, it is about the wait in front of it, and a runner that reads
 * the whole response at once cannot tell 177 milliseconds from 273 seconds. The
 * clock stops at the first character of `content` — deliberation goes to
 * `reasoning_content`, is never spoken, and must not stop it.
 */

import { buildPersonaInstructions, REALTIME_TOOLS } from '../../packages/desktop/src/common/realtime';
import { deliberationFor, noDeliberation } from '../../packages/desktop/src/common/realtime/reasoning';
import {
  AUTOMATIC_TASKS,
  MANUAL_TASKS,
  medianFirstWordMs,
  scriptOf,
  scoreOf,
  slowestFirstWordMs,
  type ConversationStep,
  type Scored,
  type TurnObservation,
} from './tasks';

const argOf = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

const ENDPOINT = argOf('endpoint', 'http://127.0.0.1:1234/v1');
const MODEL = argOf('model', 'qwen/qwen3.5-9b');
const MIN_SCORE = Number(argOf('min-score', '0'));
const AS_JSON = hasFlag('json');
const ONLY = argOf('only', '')
  .split(',')
  .map((part) => Number(part.trim()))
  .filter((id) => Number.isFinite(id) && id > 0);

/**
 * How many times each task is run before it is believed.
 *
 * `temperature: 0` was supposed to make this unnecessary and does not. Task 6
 * was watched failing with "called no tool at all" and passing with `app_learn`
 * on the very next run, same model, same prompt, same flags — a local server
 * reuses its cache and batches differently between runs, and greedy decoding is
 * only as deterministic as what is underneath it.
 *
 * That matters more here than it looks. A harness exists to tell a change from
 * no change, and one that flips a task on its own reports improvements that were
 * not made and regressions that did not happen. So a task passes only if it
 * passes *every* repeat, and the report says how often it did — a task that
 * passes two runs in three is not a passing task, it is a known flake with a
 * misleading tick beside it.
 */
const REPEAT = Math.max(1, Number(argOf('repeat', '1')) || 1);

/** The persona exactly as a spoken conversation builds it. */
const systemPrompt = (): string =>
  buildPersonaInstructions({
    presetId: 'companion',
    customInstructions: '',
    language: 'auto',
    interfaceLanguage: 'tr-TR',
    wakePhrase: 'hey fool',
    memory: {
      user: '# User Profile\n\n- Called: the user\n- Builds a desktop application in the evenings.\n',
      agent: '# What I have learned\n\n- Never read addresses out loud.\n',
      introduced: true,
    },
    voices: [],
    carried: [],
    sessionRules: [],
    localSkills: [],
    files: [],
  });

const wireTools = REALTIME_TOOLS.map((tool) => ({
  type: 'function' as const,
  function: { name: tool.name, description: tool.description, parameters: tool.parameters },
}));

/** A tool call as it comes back, assembled from however many fragments. */
type ToolCall = { id: string; name: string; argumentsJson: string };

type WireMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
};

type StreamedTurn = TurnObservation & { calls: readonly ToolCall[] };

/**
 * One streamed turn, timed to the first character a person would hear.
 *
 * Streaming is the point: the whole reason the wait is invisible in the product
 * is that a reasoning model writes its deliberation first, and a client that
 * waits for the finished object sees one number for both. Here the clock stops
 * on the first `content` delta and nothing else stops it.
 */
const askOnce = async (messages: readonly WireMessage[], said: string): Promise<StreamedTurn> => {
  const startedAt = Date.now();
  const response = await fetch(`${ENDPOINT}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages,
      tools: wireTools,
      stream: true,
      // Deterministic, because a score is a comparison and sampling makes one
      // unrepeatable. The same model on the same configuration was seen scoring
      // 8/8 and then 6/8 with nothing changed between the runs, which made every
      // number here an opinion. The product samples; the measurement must not.
      temperature: 0,
      // What the product sends. Without it a reasoning model spends its whole
      // budget deliberating and answers with no tool call at all, so a score
      // taken without it is a score for a different application.
      //
      // The decision is per sentence: a greeting is answered at once and
      // anything that might be a request to act gets the model's full
      // attention. Switching it off for everything scored 5/8 against 8/8 —
      // the three it lost were the sentences it has to think about rather
      // than pattern-match. `EVAL_THINK=1` deliberates over everything, which
      // is how that comparison was made.
      ...(process.env.EVAL_THINK === '1'
        ? {}
        : process.env.EVAL_NOTHINK === '1'
          ? noDeliberation(ENDPOINT)
          : deliberationFor(said, ENDPOINT)),
    }),
  });

  if (!response.ok || response.body === null) {
    throw new Error(`endpoint answered ${response.status}`);
  }

  let reply = '';
  let firstWordMs: number | undefined;
  /** Assembled by index, because that is the only field every fragment carries. */
  const calls = new Map<number, ToolCall>();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });

    // Server-sent events: one blank line ends an event, and only `data:` lines
    // carry anything. Split on the newline rather than on `data:` so a chunk
    // that arrives mid-line is not parsed as half a JSON object.
    let cut = buffered.indexOf('\n');
    while (cut !== -1) {
      const line = buffered.slice(0, cut).trim();
      buffered = buffered.slice(cut + 1);
      cut = buffered.indexOf('\n');

      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;

      let parsed: {
        choices?: {
          delta?: {
            content?: string | null;
            tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
          };
        }[];
      };
      try {
        parsed = JSON.parse(payload);
      } catch {
        // A malformed chunk is worth knowing about and not worth stopping for:
        // the turn is still scoreable from everything either side of it.
        console.error(`  (unparseable chunk: ${payload.slice(0, 60)})`);
        continue;
      }

      const delta = parsed.choices?.[0]?.delta;
      if (delta === undefined) continue;

      if (typeof delta.content === 'string' && delta.content.length > 0) {
        // Only the first one, and only for text: `reasoning_content` is not read
        // here at all, which is what makes this the number the room hears.
        firstWordMs ??= Date.now() - startedAt;
        reply += delta.content;
      }

      for (const fragment of delta.tool_calls ?? []) {
        const index = fragment.index ?? 0;
        const existing = calls.get(index) ?? { id: '', name: '', argumentsJson: '' };
        calls.set(index, {
          id: fragment.id ?? existing.id,
          name: fragment.function?.name ?? existing.name,
          argumentsJson: existing.argumentsJson + (fragment.function?.arguments ?? ''),
        });
      }
    }
  }

  const assembled = [...calls.values()].filter((call) => call.name.length > 0);
  return {
    reply,
    toolNames: assembled.map((call) => call.name),
    firstWordMs,
    calls: assembled,
  };
};

/**
 * One scripted conversation, with the tool results fed back in.
 *
 * A call left unanswered is not a conversation the API will take, and more to
 * the point it is not the failure being looked for: what a multi-turn test
 * catches is a model that is wrong *about a result*, which it can only be if it
 * was given one.
 */
const holdConversation = async (steps: readonly ConversationStep[]): Promise<TurnObservation[]> => {
  const messages: WireMessage[] = [{ role: 'system', content: systemPrompt() }];
  const observed: TurnObservation[] = [];

  for (const step of steps) {
    messages.push({ role: 'user', content: step.said });
    const turn = await askOnce(messages, step.said);
    observed.push({ reply: turn.reply, toolNames: turn.toolNames, firstWordMs: turn.firstWordMs });

    if (turn.calls.length === 0) continue;

    messages.push({
      role: 'assistant',
      content: turn.reply,
      tool_calls: turn.calls.map((call, index) => ({
        // An id is required and some servers stream it only once, or not at all.
        id: call.id.length > 0 ? call.id : `call_${observed.length}_${index}`,
        type: 'function' as const,
        function: { name: call.name, arguments: call.argumentsJson || '{}' },
      })),
    });
    for (const [index, call] of turn.calls.entries()) {
      messages.push({
        role: 'tool',
        tool_call_id: call.id.length > 0 ? call.id : `call_${observed.length}_${index}`,
        content: step.toolResult?.(call.name) ?? JSON.stringify({ ok: true }),
      });
    }
  }

  return observed;
};

const main = async (): Promise<void> => {
  const scored: Scored[] = [];
  const chosen = AUTOMATIC_TASKS.filter((task) => ONLY.length === 0 || ONLY.includes(task.id));

  for (const task of chosen) {
    const script = scriptOf(task);
    if (script === null) continue;

    /** Kept from the run that decided the verdict, so the report shows a real one. */
    let worst: { verdict: ReturnType<typeof script.judge>; turns: TurnObservation[] } | null = null;
    let passes = 0;

    for (let attempt = 0; attempt < REPEAT; attempt += 1) {
      let turns: TurnObservation[];
      try {
        turns = await holdConversation(script.steps);
      } catch (error) {
        console.error(`\nCould not reach ${ENDPOINT}: ${error instanceof Error ? error.message : String(error)}`);
        console.error('Start a model there, or pass --endpoint. Reporting no score rather than a score of zero.');
        process.exit(2);
      }
      const verdict = script.judge(turns);
      if (verdict.passed) passes += 1;
      // The failing run is the one worth printing: a task that fails once in
      // three has one interesting transcript and two boring ones.
      if (worst === null || (worst.verdict.passed && !verdict.passed)) worst = { verdict, turns };
    }

    const settled = worst ?? { verdict: { passed: false, because: 'never ran' }, turns: [] };
    scored.push({
      task,
      verdict:
        REPEAT === 1
          ? settled.verdict
          : { passed: passes === REPEAT, because: `${passes}/${REPEAT} runs — ${settled.verdict.because}` },
      turns: settled.turns,
    });
  }

  const { passed, total } = scoreOf(scored);
  const median = medianFirstWordMs(scored);
  const slowest = slowestFirstWordMs(scored);

  if (AS_JSON) {
    console.log(
      JSON.stringify({
        endpoint: ENDPOINT,
        model: MODEL,
        passed,
        total,
        firstWordMs: { median, slowest },
        results: scored.map((entry) => ({
          id: entry.task.id,
          said: entry.task.said,
          passed: entry.verdict.passed,
          because: entry.verdict.because,
          turns: entry.turns.map((turn) => ({
            firstWordMs: turn.firstWordMs ?? null,
            toolNames: turn.toolNames,
            reply: turn.reply.trim(),
          })),
        })),
        manual: MANUAL_TASKS.map((task) => ({ id: task.id, said: task.said, why: task.manual })),
      })
    );
  } else {
    console.log(`endpoint  ${ENDPOINT}`);
    console.log(`model     ${MODEL}\n`);
    for (const entry of scored) {
      const timings = entry.turns
        .map((turn) => (turn.firstWordMs === undefined ? '—' : `${turn.firstWordMs} ms`))
        .join(' / ');
      console.log(`${entry.verdict.passed ? 'PASS' : 'FAIL'}  ${entry.task.id}. ${entry.task.said}`);
      console.log(`      ${entry.verdict.because}`);
      console.log(`      first word: ${timings}`);
    }
    console.log(`\n${passed}/${total} automatic tasks passed.`);
    console.log(
      median === null
        ? 'first word: not measured'
        : `first word: ${median} ms median, ${slowest} ms slowest — the wait a person actually hears.`
    );
    for (const task of MANUAL_TASKS) {
      console.log(`  ${task.id}. not scored here — ${task.manual}`);
    }
  }

  if (MIN_SCORE > 0 && passed < MIN_SCORE) {
    console.error(`\nBelow the floor: ${passed} < ${MIN_SCORE}.`);
    process.exit(1);
  }
};

await main();
