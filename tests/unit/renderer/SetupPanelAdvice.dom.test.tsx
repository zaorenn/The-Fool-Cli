/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MODEL_TIERS } from '@/common/config/localModelAdvice';

/**
 * What the panel says to somebody whose gateway is running and empty.
 *
 * "It is running, but no model is loaded yet" was the whole instruction, in
 * front of a catalogue of thousands of files with names like
 * `Qwen3-14B-Q4_K_M.gguf`. The recommendation exists to end that sentence, so
 * these check it is *there*, that it names something searchable, and that it
 * does not appear where it would be wrong — beside a gateway that already has a
 * model, or one that is not installed.
 */

const openExternal = vi.fn();
const fits = MODEL_TIERS[2];

vi.mock('@/common', () => ({
  ipcBridge: {
    application: { signInToAgent: { invoke: vi.fn() } },
    shell: { openExternal: { invoke: (url: string) => openExternal(url) } },
  },
}));

vi.mock('@renderer/services/setup/detectSetup', () => ({
  detectSetup: async () => ({
    agents: new Map(),
    gateways: new Map([
      ['lm-studio', 'running-empty'],
      ['ollama', 'ready'],
      ['omniroute', 'absent'],
    ]),
    advice: {
      recommended: fits,
      alsoFits: [MODEL_TIERS[1], MODEL_TIERS[0]],
      onCpu: false,
      reason: 'gpu',
    },
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => (values ? `${key}|${Object.values(values).join('|')}` : key),
  }),
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const arco = await importOriginal<typeof import('@arco-design/web-react')>();
  return { ...arco, Message: { ...arco.Message, info: vi.fn(), success: vi.fn(), error: vi.fn() } };
});

const { default: SetupPanel } = await import('@renderer/components/settings/SetupPanel');

describe('SetupPanel, for a gateway with nothing loaded', () => {
  it('names a size that fits this computer', async () => {
    render(<SetupPanel />);

    expect(await screen.findByText(`settings.setup.advice.gpu|${fits.parameters} ${fits.quantisation}`)).toBeTruthy();
  });

  it('offers a search term rather than leaving them to name the file', async () => {
    render(<SetupPanel />);

    expect(await screen.findByText(fits.examples[0])).toBeTruthy();
  });

  it('says plainly what that size is good for', async () => {
    render(<SetupPanel />);

    expect(await screen.findByText(fits.suitedTo)).toBeTruthy();
  });

  it('mentions the alternatives in one line rather than as more cards', async () => {
    render(<SetupPanel />);

    const alternatives = `${MODEL_TIERS[1].parameters}, ${MODEL_TIERS[0].parameters}`;
    expect(await screen.findByText(`settings.setup.advice.alsoFits|${alternatives}`)).toBeTruthy();
  });

  it('says it once, beside the gateway that asked the question', async () => {
    render(<SetupPanel />);

    await screen.findByText(fits.examples[0]);
    // Three gateways are rendered; only the empty one has anything to load.
    expect(screen.getAllByText(fits.examples[0])).toHaveLength(1);
  });
});
