import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const SKILL_ROOT = resolve('backend/core/crates/fool-app/assets/builtin-skills/auto-inject/shared-memory');
const SCRIPT = join(SKILL_ROOT, 'scripts', 'shared-memory.mjs');

const run = (args: string[], input?: string) => {
  const root = mkdtempSync(join(tmpdir(), 'fool-memory-test-'));
  const memoryPath = join(root, 'memory.json');
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    input,
    env: { ...process.env, FOOL_SHARED_MEMORY_PATH: memoryPath },
  });
  return { ...result, memoryPath };
};

describe('shared-memory builtin skill', () => {
  /**
   * It was superseded rather than deleted.
   *
   * What it wrote lands in `~/.the-fool/shared-memory.json` — durable, shared
   * with every agent, and invisible to the person it is about, who therefore
   * cannot correct a word of it. That is what the two markdown documents
   * replaced, so the skill's job now is to be read once and migrated from,
   * while the file itself stays where it is.
   */
  it('sends anything new to the documents rather than to its own file', () => {
    const body = readFileSync(join(SKILL_ROOT, 'SKILL.md'), 'utf8');
    expect(body).toContain('It is not where memory lives any more');
    expect(body).toContain('Do not call `remember`');
    // Still readable, so an install that has been here a while keeps what it had.
    expect(body).toContain('shared-memory.mjs list');
  });

  it('persists a bounded memory record and can search it', () => {
    const root = mkdtempSync(join(tmpdir(), 'fool-memory-test-'));
    const memoryPath = join(root, 'memory.json');
    const env = { ...process.env, FOOL_SHARED_MEMORY_PATH: memoryPath };
    const remembered = spawnSync(process.execPath, [SCRIPT, 'remember'], {
      encoding: 'utf8',
      input: JSON.stringify({ text: 'Kullanıcı sade arayüz tercih ediyor', tags: ['ui', 'preference'] }),
      env,
    });
    const searched = spawnSync(process.execPath, [SCRIPT, 'search', 'sade'], {
      encoding: 'utf8',
      env,
    });

    expect(remembered.status).toBe(0);
    expect(JSON.parse(searched.stdout)).toMatchObject({
      entries: [expect.objectContaining({ text: 'Kullanıcı sade arayüz tercih ediyor' })],
    });
  });

  it('rejects secret-like memory', () => {
    const result = run(['remember'], JSON.stringify({ text: 'API key: sk-secret-value' }));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('secret');
  });
});
