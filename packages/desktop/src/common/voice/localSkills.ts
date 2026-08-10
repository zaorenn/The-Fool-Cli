/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Something the user taught it that it can then simply do.
 *
 * The app could already be taught a *way of working*: a note in the memory that
 * the assistant reads and then carries out with whatever general tools it has.
 * For anything on the machine that meant handing the job to an agent, which
 * takes minutes. "Play my favourite song" going through an agent is the
 * difference between an assistant and a form you fill in slowly, and it is the
 * gap the user described.
 *
 * So a local skill binds words they say to one concrete action this app can
 * perform by itself. Two kinds, because between them they cover what was asked
 * for: open an address, and open something on the machine.
 *
 * That is also what makes this the most dangerous record in the app. It is
 * written by a model, out of a conversation that may have included a web page or
 * a document, and it ends up being executed. So it is closed by construction —
 * `http(s)` only, absolute paths only, nothing that could carry an argument —
 * and every skill is listed in the settings where the user can read and delete
 * it. A capability the user cannot see is a capability they cannot withdraw.
 *
 * Shared by main and renderer, so nothing here touches the DOM or the disk.
 */

export type LocalSkillAction =
  /** Somewhere on the web. */
  | { kind: 'open-url'; url: string }
  /** Something on this machine: a program, a folder, a document. */
  | { kind: 'open-path'; path: string };

export type LocalSkill = {
  /** Derived from the name, so teaching the same skill again replaces it. */
  id: string;
  /** What they call it. "Favourite song". */
  name: string;
  /** When it applies, in their words. This is what a spoken request is matched against. */
  when: string;
  action: LocalSkillAction;
};

/** Where the library lives. */
export const LOCAL_SKILLS_CONFIG_KEY = 'voice.localSkills';

/** The most that may be kept. Enough for a real repertoire, bounded all the same. */
export const MAX_LOCAL_SKILLS = 40;

const MAX_NAME = 48;
const MAX_WHEN = 160;
const MAX_TARGET = 512;

const clean = (value: unknown, limit: number): string =>
  typeof value === 'string' ? value.replaceAll(/\s+/g, ' ').trim().slice(0, limit) : '';

export const localSkillId = (name: string): string => clean(name, MAX_NAME).toLowerCase();

/**
 * Whether an address is one this app will hand to a browser.
 *
 * The web and nothing else. `file:` would open anything on the disk, `javascript:`
 * runs in whatever opens it, and `data:` is a document written by whoever wrote
 * the skill — none of those are "a page the user wanted to go back to", which is
 * the entire purpose of the kind.
 */
const isWebAddress = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
};

/**
 * Whether a path is a thing being opened rather than a command being run.
 *
 * The distinction is the whole of the safety here. `C:\FL\FL64.exe` is a program
 * the user opened and wants opened again. `cmd.exe /c del *.*` is somebody
 * else's instructions wearing a path's clothes, and the shell characters below
 * are how that is smuggled in. Absolute only, because a relative path resolves
 * against whatever directory the app happens to be in, which is not a thing the
 * user chose.
 */
const isPlainAbsolutePath = (value: string): boolean => {
  if (value.length === 0) return false;
  // Anything that could separate, chain, redirect or expand a command.
  if (/[&|;<>^`$\n\r"']/.test(value)) return false;
  // An argument: a program followed by a switch. `-` and `/` are both used on
  // Windows, so a space before either is enough to refuse.
  if (/\s[-/]/.test(value)) return false;
  if (value.includes('..')) return false;

  const windowsAbsolute = /^[a-zA-Z]:[\\/]/.test(value);
  const uncOrPosixAbsolute = value.startsWith('\\\\') || value.startsWith('/');
  return windowsAbsolute || uncOrPosixAbsolute;
};

const readAction = (value: unknown): LocalSkillAction | null => {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;

  if (record.kind === 'open-url') {
    const url = clean(record.url, MAX_TARGET);
    return isWebAddress(url) ? { kind: 'open-url', url } : null;
  }

  if (record.kind === 'open-path') {
    const path = clean(record.path, MAX_TARGET);
    return isPlainAbsolutePath(path) ? { kind: 'open-path', path } : null;
  }

  // A kind this version does not have is dropped rather than guessed at. A
  // skill repaired into a different action is one the user never taught.
  return null;
};

/**
 * Repairs the library, dropping anything that cannot be trusted to run.
 *
 * Dropped rather than repaired, throughout. Every other sanitiser in the app
 * falls back to a default when a field is unreadable, because the cost of being
 * wrong is a window drawn the wrong shape. Here the cost is running something,
 * so there is no default worth having.
 */
export const sanitizeLocalSkills = (value: unknown): LocalSkill[] => {
  if (!Array.isArray(value)) return [];

  const byId = new Map<string, LocalSkill>();

  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue;
    const record = raw as Record<string, unknown>;

    const name = clean(record.name, MAX_NAME);
    const when = clean(record.when, MAX_WHEN);
    const action = readAction(record.action);
    // No trigger means a skill nothing can ever reach; no name means one the
    // user cannot refer to or delete.
    if (name.length === 0 || when.length === 0 || !action) continue;

    const id = localSkillId(name);
    // Later wins: teaching the same skill again is correcting it.
    byId.set(id, { id, name, when, action });
  }

  return [...byId.values()].slice(-MAX_LOCAL_SKILLS);
};

/**
 * The skill a spoken request is asking for, or nothing.
 *
 * Matched against the name and the trigger together, and loosely, because nobody
 * repeats the name they invented last week word for word — "put my favourite
 * song on" has to find "Favourite song". Nothing rather than a guess: running
 * the wrong skill is worse than saying it does not know one.
 */
/**
 * Turns of phrase that ask *about* a skill rather than *for* it.
 *
 * "Favori şarkımı hatırlıyor musun" contains the trigger for the favourite
 * song, so the matcher ran it: the user asked whether it remembered, and it
 * answered by playing the song and saying nothing. Both halves of that were
 * wrong, and this is the half that belongs here.
 *
 * A short closed list, and the same asymmetry the deliberation rule uses: not
 * running a skill the user did ask for costs one repeat, while running one they
 * only mentioned takes over the room. Questions are the shape that is safe to
 * refuse.
 */
const ASKS_ABOUT = [
  // Turkish
  'hatırlıyor musun',
  'hatirliyor musun',
  'biliyor musun',
  'hatırlıyor musunuz',
  'ne demiştim',
  'ne idi',
  'neydi',
  'hangi',
  'var mı',
  'var mi',
  'nedir',
  // English
  'do you remember',
  'do you know',
  'what is my',
  "what's my",
  'what was my',
  'which one',
  'can you remember',
] as const;

/**
 * Whether the sentence is a question about a skill instead of a request to run
 * one. Exported so the rule can be read and argued with on its own.
 */
export const asksAboutSkill = (said: string): boolean => {
  const line = said.trim().toLowerCase();
  return ASKS_ABOUT.some((phrase) => line.includes(phrase));
};

export const findLocalSkill = (skills: readonly LocalSkill[], said: string): LocalSkill | null => {
  const wanted = clean(said, MAX_WHEN).toLowerCase();
  if (wanted.length === 0) return null;
  // Asked whether it remembers something, the answer is a sentence — not the
  // thing itself. Running the skill here is how "do you remember my favourite
  // song?" became the song playing with no reply.
  if (asksAboutSkill(wanted)) return null;

  const exact = skills.find((skill) => skill.id === wanted);
  if (exact) return exact;

  const contained = skills.find((skill) => wanted.includes(skill.id) || skill.id.includes(wanted));
  if (contained) return contained;

  // Then on the words of the trigger, which is how it was described rather than
  // what it was called. Every significant word has to appear, so "the studio"
  // finds "when I say open the studio" and "order a pizza" finds nothing.
  return (
    skills.find((skill) => {
      const words = skill.name
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word.length > 3);
      return words.length > 0 && words.every((word) => wanted.includes(word));
    }) ?? null
  );
};

/**
 * The skills, as the model is told about them.
 *
 * Names and triggers only. The model's job is to notice that a request is one of
 * these and call for it by name — it never needs the address, and putting one in
 * the prompt only invites it to read it out loud or to invent a neighbouring
 * one.
 */
export const describeLocalSkills = (skills: readonly LocalSkill[]): string => {
  if (skills.length === 0) return '';

  return [
    '# What you can already do yourself',
    'These are things this person taught you. Each one you can do immediately by calling app_skill_do with its name — no agent, no waiting. When a request is one of these, do it rather than describing it or handing it to the agent.',
    ...skills.map((skill) => `- ${skill.name} — ${skill.when}`),
  ].join('\n');
};
