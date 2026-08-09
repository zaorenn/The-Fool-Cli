/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Run the ten tasks and say how many passed.
 *
 * Every claim this project has made about being capable was unfalsifiable
 * because there was nothing that ran the list. This runs it: the same persona
 * and the same tools a spoken conversation advertises, one turn per task, and a
 * verdict from `tasks.ts` — which is pure, and tested.
 *
 *   bun scripts/eval/run.ts
 *   bun scripts/eval/run.ts --endpoint http://127.0.0.1:1234/v1 --model google/gemma-4-e4b
 *   bun scripts/eval/run.ts --min-score 7        # non-zero exit below the floor
 *   bun scripts/eval/run.ts --json               # one object, for a chart later
 *
 * It needs a model endpoint. Without one it says so and exits non-zero rather
 * than reporting a score of zero, which would look like a regression.
 */

import { buildPersonaInstructions, REALTIME_TOOLS } from '../../packages/desktop/src/common/realtime';
import { AUTOMATIC_TASKS, SPOKEN_TASKS, type Scored, type TurnObservation, scoreOf } from './tasks';

const argOf = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

const ENDPOINT = argOf('endpoint', 'http://127.0.0.1:1234/v1');
const MODEL = argOf('model', 'google/gemma-4-e4b');
const MIN_SCORE = Number(argOf('min-score', '0'));
const AS_JSON = hasFlag('json');

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

type ChatResponse = {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: { function?: { name?: string } }[];
    };
  }[];
};

/** One turn, non-streamed: nothing here is timed, so nothing is gained by it. */
const askOnce = async (said: string): Promise<TurnObservation> => {
  const response = await fetch(`${ENDPOINT}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt() },
        { role: 'user', content: said },
      ],
      tools: wireTools,
    }),
  });

  if (!response.ok) throw new Error(`endpoint answered ${response.status}`);

  const parsed = (await response.json()) as ChatResponse;
  const message = parsed.choices?.[0]?.message;
  return {
    reply: message?.content ?? '',
    toolNames: (message?.tool_calls ?? []).map((call) => call.function?.name ?? '').filter((name) => name.length > 0),
  };
};

const main = async (): Promise<void> => {
  const scored: Scored[] = [];

  for (const task of AUTOMATIC_TASKS) {
    let turn: TurnObservation;
    try {
      turn = await askOnce(task.said);
    } catch (error) {
      console.error(`\nCould not reach ${ENDPOINT}: ${error instanceof Error ? error.message : String(error)}`);
      console.error('Start a model there, or pass --endpoint. Reporting no score rather than a score of zero.');
      process.exit(2);
    }
    scored.push({ task, verdict: task.judge(turn) });
  }

  const { passed, total } = scoreOf(scored);
  const manual = SPOKEN_TASKS.filter((task) => task.manual !== undefined);

  if (AS_JSON) {
    console.log(
      JSON.stringify({
        endpoint: ENDPOINT,
        model: MODEL,
        passed,
        total,
        results: scored.map((entry) => ({
          id: entry.task.id,
          said: entry.task.said,
          passed: entry.verdict.passed,
          because: entry.verdict.because,
        })),
        manual: manual.map((task) => ({ id: task.id, said: task.said, why: task.manual })),
      }),
    );
  } else {
    console.log(`endpoint  ${ENDPOINT}`);
    console.log(`model     ${MODEL}\n`);
    for (const entry of scored) {
      console.log(`${entry.verdict.passed ? 'PASS' : 'FAIL'}  ${entry.task.id}. ${entry.task.said}`);
      console.log(`      ${entry.verdict.because}`);
    }
    console.log(`\n${passed}/${total} automatic tasks passed.`);
    for (const task of manual) {
      console.log(`  ${task.id}. not scored here — ${task.manual}`);
    }
  }

  if (MIN_SCORE > 0 && passed < MIN_SCORE) {
    console.error(`\nBelow the floor: ${passed} < ${MIN_SCORE}.`);
    process.exit(1);
  }
};

await main();
