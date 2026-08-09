/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { MODEL_TIERS, VRAM_HEADROOM_GB, adviseLocalModel, usableBudgetGb } from '@/common/config/localModelAdvice';

describe('usableBudgetGb', () => {
  it('leaves the card room for the window and a speaking voice', () => {
    // A tier chosen with no headroom loads and then stalls the first time
    // somebody talks to it, which reads as the app being slow.
    expect(usableBudgetGb({ vramGb: 8, ramGb: 32 })).toEqual({ budget: 8 - VRAM_HEADROOM_GB, onCpu: false });
  });

  it('falls back to system memory when there is no usable card', () => {
    expect(usableBudgetGb({ vramGb: null, ramGb: 32 })).toEqual({ budget: 16, onCpu: true });
    expect(usableBudgetGb({ vramGb: 2, ramGb: 16 })).toEqual({ budget: 8, onCpu: true });
  });
});

describe('adviseLocalModel', () => {
  it('recommends the 7–8B class on the 8 GB card this is aimed at', () => {
    const advice = adviseLocalModel({ vramGb: 8, ramGb: 32 });

    expect(advice.recommended?.parameters).toBe('7–8B');
    expect(advice.onCpu).toBe(false);
    expect(advice.reason).toBe('gpu');
  });

  it('uses a big card properly rather than playing safe', () => {
    // Recommending two sizes down "to be safe" is how a 24 GB machine ends up
    // running an 8B and its owner concludes local models are not good enough.
    expect(adviseLocalModel({ vramGb: 24, ramGb: 64 }).recommended?.parameters).toBe('30–32B');
    expect(adviseLocalModel({ vramGb: 16, ramGb: 32 }).recommended?.parameters).toBe('12–14B');
  });

  it('offers the smaller ones underneath, largest first', () => {
    const advice = adviseLocalModel({ vramGb: 24, ramGb: 64 });

    expect(advice.alsoFits.map((tier) => tier.parameters)).toEqual(['24–27B', '12–14B', '7–8B', '3–4B']);
  });

  it('says plainly when nothing fits', () => {
    const advice = adviseLocalModel({ vramGb: null, ramGb: 6 });

    expect(advice.recommended).toBeNull();
    expect(advice.reason).toBe('too-small');
  });

  it('admits when it could not read the card', () => {
    expect(adviseLocalModel({ vramGb: null, ramGb: 32 }).reason).toBe('unknown');
  });

  it('never recommends something larger than the budget', () => {
    for (const vramGb of [4, 6, 8, 10, 12, 16, 24, 32, 48]) {
      const advice = adviseLocalModel({ vramGb, ramGb: 64 });
      if (!advice.recommended) continue;
      expect(advice.recommended.needsVramGb, `${vramGb} GB`).toBeLessThanOrEqual(vramGb - VRAM_HEADROOM_GB);
    }
  });
});

describe('the tier table', () => {
  it('is ordered and describes every tier honestly', () => {
    const sizes = MODEL_TIERS.map((tier) => tier.needsVramGb);
    expect(sizes).toEqual([...sizes].toSorted((a, b) => a - b));

    for (const tier of MODEL_TIERS) {
      expect(tier.examples.length, tier.parameters).toBeGreaterThan(0);
      expect(tier.suitedTo.length, tier.parameters).toBeGreaterThan(20);
    }
  });
});
