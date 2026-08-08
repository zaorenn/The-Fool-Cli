/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which local model to suggest for the machine somebody actually has.
 *
 * "Install LM Studio and load a model" is where local-first quietly fails. The
 * catalogue is thousands of files with names like `Qwen3-14B-Q4_K_M.gguf`, and
 * the only way to learn that the 14B will not fit in 8 GB is to download twelve
 * gigabytes and watch it fail. Somebody who has never done this gives up there,
 * and reasonably.
 *
 * So the app measures the card and says what will fit. Deliberately opinionated:
 * one recommendation per machine, with the alternatives underneath, because a
 * list of nine is the same problem in a smaller font.
 *
 * **These are size calculations, not benchmarks.** What is claimed here is that
 * a model of this size fits alongside everything else this app loads — nothing
 * about how good it is. The numbers below are the quantised weights plus the
 * working memory a context of useful length needs; measure quality yourself.
 */

export type ModelTier = {
  /** Roughly how many billions of parameters, as the catalogue names them. */
  parameters: string;
  /** The quantisation these figures assume. */
  quantisation: string;
  /** What to search for in LM Studio. */
  examples: readonly string[];
  /** Total VRAM this tier wants, in whole gigabytes. */
  needsVramGb: number;
  /** What it is realistically good for, stated without flattery. */
  suitedTo: string;
};

/**
 * How much graphics memory to leave for everything that is not the model.
 *
 * The desktop compositor takes some, this app's own window takes some, and a
 * local voice takes more — a speaking model is loaded on the same card. A tier
 * chosen with no headroom loads and then stalls the first time somebody talks
 * to it, which reads as the app being slow rather than the card being full.
 */
export const VRAM_HEADROOM_GB = 2;

export const MODEL_TIERS: readonly ModelTier[] = [
  {
    parameters: '3–4B',
    quantisation: 'Q4',
    examples: ['Qwen3 4B', 'Gemma 3 4B', 'Llama 3.2 3B'],
    needsVramGb: 4,
    suitedTo: 'Conversation, dictation and short edits. Struggles with multi-step work.',
  },
  {
    parameters: '7–8B',
    quantisation: 'Q4',
    examples: ['Qwen3 8B', 'Llama 3.1 8B', 'Gemma 3 8B'],
    needsVramGb: 6,
    suitedTo: 'The usual starting point: everyday questions, small code changes, reliable tool calls.',
  },
  {
    parameters: '12–14B',
    quantisation: 'Q4',
    examples: ['Qwen3 14B', 'Gemma 3 12B', 'Phi-4 14B'],
    needsVramGb: 10,
    suitedTo: 'Noticeably better at holding a plan across several steps.',
  },
  {
    parameters: '24–27B',
    quantisation: 'Q4',
    examples: ['Mistral Small 3', 'Gemma 3 27B'],
    needsVramGb: 16,
    suitedTo: 'Comfortable with real code and longer context.',
  },
  {
    parameters: '30–32B',
    quantisation: 'Q4',
    examples: ['Qwen3 32B', 'QwQ 32B'],
    needsVramGb: 20,
    suitedTo: 'About as far as a single consumer card goes before it stops being fast.',
  },
  {
    parameters: '70B',
    quantisation: 'Q4',
    examples: ['Llama 3.3 70B', 'Qwen3 72B'],
    needsVramGb: 40,
    suitedTo: 'Two cards, or one workstation card. Slow but capable.',
  },
];

export type MachineMemory = {
  /** Graphics memory in gigabytes, or null when it could not be read. */
  vramGb: number | null;
  /** System memory in gigabytes, for the case where there is no usable card. */
  ramGb: number;
};

export type LocalModelAdvice = {
  /** The one to start with. Null when nothing on the list fits. */
  recommended: ModelTier | null;
  /** Everything that fits, largest first. */
  alsoFits: readonly ModelTier[];
  /** Whether this would be running on the processor rather than a card. */
  onCpu: boolean;
  /** Said plainly to the user, and the reason the recommendation is what it is. */
  reason: 'gpu' | 'no-gpu' | 'too-small' | 'unknown';
};

/**
 * The budget a model may actually use, once everything else has its share.
 *
 * A machine with no readable card falls back to system memory and a much
 * harsher fraction: sharing RAM with the operating system is not the same
 * bargain as owning a card, and a tier picked as though it were will swap.
 */
export const usableBudgetGb = ({ vramGb, ramGb }: MachineMemory): { budget: number; onCpu: boolean } => {
  if (vramGb !== null && vramGb >= 4) return { budget: vramGb - VRAM_HEADROOM_GB, onCpu: false };
  return { budget: Math.floor(ramGb / 2), onCpu: true };
};

/**
 * What to suggest, given what the machine has.
 *
 * The largest that fits, rather than the safest. Somebody who bought a card
 * wants it used, and the tiers already carry the headroom — recommending two
 * sizes down "to be safe" is how a 24 GB machine ends up running an 8B and
 * concluding local models are not good enough.
 */
export const adviseLocalModel = (memory: MachineMemory): LocalModelAdvice => {
  const { budget, onCpu } = usableBudgetGb(memory);
  const fits = MODEL_TIERS.filter((tier) => tier.needsVramGb <= budget).toSorted(
    (a, b) => b.needsVramGb - a.needsVramGb
  );

  if (fits.length === 0) {
    return { recommended: null, alsoFits: [], onCpu, reason: 'too-small' };
  }

  return {
    recommended: fits[0],
    alsoFits: fits.slice(1),
    onCpu,
    reason: memory.vramGb === null ? 'unknown' : onCpu ? 'no-gpu' : 'gpu',
  };
};
