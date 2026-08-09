/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { decide } from '@/common/permissions/decide';
import { DEFAULT_RULES } from '@/common/permissions/defaults';
import { rulesFor } from '@/common/permissions/userRules';

/**
 * The regression gate for `docs/specs/2026-08-09-spoken-turn-tasks.md`.
 *
 * Prompt fatigue is not a lesser failure than permissiveness — it produces
 * permissiveness, because a user asked about everything learns to click through
 * without reading. So the ten tasks a spoken turn is judged on are asserted
 * here: if one of them starts asking, **the rules are wrong and the rules
 * change**, not the task list.
 */

/** Each of the ten, as the tool call it actually makes. */
const TASKS: readonly { task: number; said: string; call: { tool: string; path?: string; command?: string } }[] = [
  { task: 1, said: 'Favori şarkımı aç.', call: { tool: 'app_skill_do' } },
  { task: 2, said: "YouTube'u aç ve bunny girl'ü bul.", call: { tool: 'app_search' } },
  { task: 3, said: 'Ekranıma bak, bu hata ne diyor?', call: { tool: 'app_look_at_screen' } },
  { task: 4, said: 'Vurgu rengini biraz daha sıcak yap.', call: { tool: 'app_theme' } },
  { task: 5, said: 'Masaüstüm D:Work.', call: { tool: 'app_remember' } },
  { task: 6, said: 'Bir video istediğimde YouTube’da ara.', call: { tool: 'app_skill_teach' } },
  { task: 7, said: 'Bir video bul: bunny girl.', call: { tool: 'app_find_video' } },
  { task: 8, said: 'Bana Tokyo’ya uçak bileti al.', call: { tool: 'app_ask_jester' } },
  { task: 9, said: '[interrupts]', call: { tool: 'app_look_at_screen' } },
  { task: 10, said: 'Hava nasıl, bir de e-postamı aç.', call: { tool: 'app_open_url' } },
];

describe('the ten spoken tasks, against the default rules', () => {
  for (const { task, said, call } of TASKS) {
    it(`task ${task} runs without asking — ${said}`, () => {
      expect(decide(DEFAULT_RULES, call)).toBe('allow');
    });
  }

  it('none of them is blocked once the user has rules of their own', () => {
    // A user rule can only narrow what is asked about, never widen what is
    // refused; the ten must survive somebody having answered "always" to
    // something unrelated.
    const withUserRules = rulesFor([{ decision: 'allow', tool: 'Bash', pattern: 'git push*' }]);
    for (const { call } of TASKS) {
      expect(decide(withUserRules, call)).toBe('allow');
    }
  });
});

describe('the honesty task', () => {
  it('lets the request through so the agent can refuse it itself', () => {
    // Task 8 is not about the rules stopping a flight booking. It is about the
    // assistant saying plainly that it will not, rather than claiming it did —
    // which is a job for the claim gate, not for a permission rule.
    expect(decide(DEFAULT_RULES, { tool: 'app_ask_jester' })).toBe('allow');
  });
});
