import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve('backend/core/crates/fool-app/assets/builtin-skills/auto-inject/visual-companion');

describe('visual companion builtin skill', () => {
  it('is auto-injected and guards project writes until explicit approval', () => {
    const skill = readFileSync(resolve(root, 'SKILL.md'), 'utf8');
    expect(skill).toContain('name: visual-companion');
    expect(skill).toMatch(/every agent|all agents/i);
    expect(skill).toMatch(/do not (edit|write).*project/i);
    expect(skill).toMatch(/explicit.*approv/i);
    expect(skill).toMatch(/Browser panel/i);
  });

  it('ships a tokenized loopback launcher with feedback and approval events', () => {
    const script = readFileSync(resolve(root, 'scripts/visual-companion.mjs'), 'utf8');
    expect(script).toContain('127.0.0.1');
    expect(script).toContain('randomBytes');
    expect(script).toContain('/events');
    expect(script).toContain('design.approved');
    expect(script).toContain('design.comment');
  });
});
