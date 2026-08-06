/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FOOL_VOICE_SETTINGS, VOICE_DEFAULT_ASSISTANT_ID } from '@/common/types/foolVoice';

/**
 * The assistant a spoken conversation is pointed at, and whether it exists.
 *
 * These are two files in two languages that no compiler relates: the default is
 * a string in TypeScript, and the assistant it names is an entry in a JSON
 * manifest compiled into the Rust binary. Nothing fails loudly when they
 * disagree — the voice simply hands its work to an assistant that is not there,
 * or to whichever one happens to be first, which is how "find me some mods and
 * open them" came to be answered by the app's setup butler.
 *
 * So the relationship is asserted here rather than discovered in a conversation.
 */

const MANIFEST = path.join(process.cwd(), 'backend/core/crates/fool-app/assets/builtin-assistants/assistants.json');

type BuiltinAssistant = {
  id: string;
  sort_order?: number;
  default_enabled?: boolean;
  agent_ref?: string;
  rule_file?: string;
  enabled_skills?: string[];
};

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { assistants: BuiltinAssistant[] };
const byId = (id: string): BuiltinAssistant | undefined => manifest.assistants.find((entry) => entry.id === id);

describe('the assistant a spoken conversation defaults to', () => {
  it('names one the manifest actually ships', () => {
    expect(byId(VOICE_DEFAULT_ASSISTANT_ID)).toBeDefined();
  });

  it('is the one the stored settings default to', () => {
    expect(DEFAULT_FOOL_VOICE_SETTINGS.session.assistantId).toBe(VOICE_DEFAULT_ASSISTANT_ID);
  });

  /**
   * An assistant off by default is absent from the picker, so a default naming
   * one is a default the user cannot see and did not choose.
   */
  it('ships enabled, so it is in the list the picker draws', () => {
    expect(byId(VOICE_DEFAULT_ASSISTANT_ID)?.default_enabled).toBe(true);
  });

  it('has the rule file it declares, in the locale everything falls back to', () => {
    const declared = byId(VOICE_DEFAULT_ASSISTANT_ID)?.rule_file;
    expect(declared).toBeDefined();

    const file = path.join(path.dirname(MANIFEST), String(declared).replace('{locale}', 'en-US'));
    expect(readFileSync(file, 'utf8').length).toBeGreaterThan(0);
  });

  /**
   * The instrument the rest of it depends on. A personal assistant that cannot
   * touch the machine is a chat window with extra steps.
   */
  it('is given the computer, since that is what it is for', () => {
    expect(byId(VOICE_DEFAULT_ASSISTANT_ID)?.enabled_skills).toContain('computer_use');
  });

  it('sorts ahead of the setup butler, which is the rarer job', () => {
    const fool = byId(VOICE_DEFAULT_ASSISTANT_ID)?.sort_order ?? 0;
    const jester = byId('fool-assistant')?.sort_order ?? 0;

    expect(fool).toBeLessThan(jester);
  });
});
