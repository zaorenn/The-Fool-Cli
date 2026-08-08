/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What one spoken turn costs today, before the harness move.
 *
 * The design gates the move on numbers rather than on an argument, and half of
 * those numbers — the half that does not need a microphone — can be taken
 * honestly from here: how large the prompt is, how long the model takes to its
 * first token, and how long the whole answer takes. Time to first *audio* needs
 * a speaker and a person, and is not guessed at.
 *
 * The prompt is not approximated. It is built by the same
 * `buildPersonaInstructions` the running app calls, with the same
 * `REALTIME_TOOLS`, so what is measured is what is actually sent.
 *
 *   bun scripts/measure-spoken-turn.ts
 *   bun scripts/measure-spoken-turn.ts --endpoint http://127.0.0.1:1234/v1 --model google/gemma-4-e4b
 */

import { buildPersonaInstructions, REALTIME_TOOLS } from '../packages/desktop/src/common/realtime';

type Usage = { prompt_tokens?: number; completion_tokens?: number };

type Measured = {
  said: string;
  promptTokens: number;
  completionTokens: number;
  toFirstTokenMs: number;
  totalMs: number;
  toolCalls: number;
};

const argOf = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const ENDPOINT = argOf('endpoint', 'http://127.0.0.1:1234/v1');
const MODEL = argOf('model', 'google/gemma-4-e4b');

/**
 * The ten from `docs/specs/2026-08-09-spoken-turn-tasks.md`.
 *
 * Two of them cannot be driven from here — interrupting mid-answer needs a
 * speaker, and the skill in task 7 depends on task 6 having been taught in a
 * real session — so eight are measured and the other two are named as absent
 * rather than quietly dropped.
 */
const SAID: readonly string[] = [
  'Favori şarkımı aç.',
  "YouTube'u aç ve bunny girl'ü bul.",
  'Ekranıma bak ve bu hata ne diyor söyle.',
  'Vurgu rengini biraz daha sıcak yap.',
  'Masaüstüm D:\\Work. Masaüstüm nerede?',
  'Bir video istediğimde YouTube\u2019da ara ve ilk sonucu aç.',
  'Bana Tokyo\u2019ya uçak bileti al.',
  'Hava nasıl, bir de e-postamı aç.',
];

/** The persona exactly as a spoken conversation builds it today. */
const spokenSystemPrompt = (): string =>
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

const toWire = (tools: readonly (typeof REALTIME_TOOLS)[number][]) =>
  tools.map((tool) => ({
    type: 'function' as const,
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));

const wireTools = toWire(REALTIME_TOOLS);

/**
 * The set a spoken conversation would advertise if the rest were deferred.
 *
 * Looking, delegating, searching, opening, running a taught skill, remembering.
 * Everything else — the theme, the settings, the workspace, the skill editor —
 * is a tool the model can be told about when it is wanted, and `ToolSearch`
 * exists in the agent runtime to do exactly that.
 */
const CORE = new Set([
  'app_look_at_screen',
  'app_ask_jester',
  'app_search',
  'app_open_url',
  'app_skill_do',
  'app_remember',
]);

const coreTools = toWire(REALTIME_TOOLS.filter((tool) => CORE.has(tool.name)));

const measureOne = async (systemPrompt: string, said: string, tools: ReturnType<typeof toWire>): Promise<Measured> => {
  const started = Date.now();
  let firstToken = 0;
  let completion = '';
  let toolCalls = 0;
  let usage: Usage = {};

  const response = await fetch(`${ENDPOINT}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: said },
      ],
      tools,
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`endpoint answered ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') continue;

      const parsed = JSON.parse(payload) as {
        choices?: { delta?: { content?: string; tool_calls?: unknown[] } }[];
        usage?: Usage;
      };
      if (parsed.usage) usage = parsed.usage;

      const delta = parsed.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.tool_calls) toolCalls += delta.tool_calls.length;
      if (typeof delta.content === 'string' && delta.content.length > 0) {
        // The one latency a person experiences is the wait before anything
        // happens. Everything after it overlaps with them listening.
        if (firstToken === 0) firstToken = Date.now();
        completion += delta.content;
      }
    }
  }

  return {
    said,
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? completion.length,
    toFirstTokenMs: firstToken === 0 ? 0 : firstToken - started,
    totalMs: Date.now() - started,
    toolCalls,
  };
};

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)];
};

const main = async (): Promise<void> => {
  const systemPrompt = spokenSystemPrompt();
  const schemaChars = JSON.stringify(wireTools).length;

  console.log(`endpoint      ${ENDPOINT}`);
  console.log(`model         ${MODEL}`);
  console.log(`persona       ${systemPrompt.length} chars`);
  console.log(`tool schemas  ${schemaChars} chars, ${wireTools.length} tools`);
  console.log('');

  // Interleaved and alternated on purpose. A first pass measured the two
  // configurations one after the other and reported that the *smaller* prompt
  // was slower — which is not a fact about prompts, it is a fact about a warm
  // cache, a busy machine and eight samples. Alternating which one goes first
  // for each sentence removes the order from the answer.
  const all: Measured[] = [];
  const core: Measured[] = [];

  for (const [index, said] of SAID.entries()) {
    const order: [string, ReturnType<typeof toWire>, Measured[]][] =
      index % 2 === 0
        ? [
            ['all', wireTools, all],
            ['core', coreTools, core],
          ]
        : [
            ['core', coreTools, core],
            ['all', wireTools, all],
          ];

    for (const [label, tools, into] of order) {
      try {
        const one = await measureOne(systemPrompt, said, tools);
        into.push(one);
        console.log(
          `${label.padEnd(5)} ${one.promptTokens.toString().padStart(6)} tok  ` +
            `${one.toFirstTokenMs.toString().padStart(6)} ms first  ` +
            `${one.totalMs.toString().padStart(6)} ms total  ` +
            `${one.toolCalls} tools  ${one.said}`
        );
      } catch (error) {
        console.log(`  FAILED  ${label} ${said}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const report = (label: string, measured: readonly Measured[]): void => {
    if (measured.length === 0) return;
    const firsts = measured.map((m) => m.toFirstTokenMs).filter((ms) => ms > 0);
    console.log('');
    console.log(`${label}`);
    console.log(`  prompt               ${median(measured.map((m) => m.promptTokens))} tokens`);
    console.log(
      `  to first token       median ${median(firsts)} ms, spread ${Math.min(...firsts)}–${Math.max(...firsts)} ms`
    );
    console.log(`  total                median ${median(measured.map((m) => m.totalMs))} ms`);
    console.log(`  turns calling a tool ${measured.filter((m) => m.toolCalls > 0).length}/${measured.length}`);
  };

  report('every tool advertised, as today', all);
  report('core tools only, the rest deferred', core);

  if (all.length > 0 && core.length > 0) {
    console.log('');
    console.log(
      `deferring the rest removes ${median(all.map((m) => m.promptTokens)) - median(core.map((m) => m.promptTokens))} prompt tokens.`
    );
    console.log(
      'Whether that is faster is not settled by this sample: the spread above overlaps, and eight sentences on one machine is not enough to separate the two.'
    );
  }
};

void main();
