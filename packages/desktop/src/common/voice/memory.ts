/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the voice remembers between conversations.
 *
 * Every session started from nothing: the assistant was told who it was and
 * nothing about who it was talking to, so the first thing it did each time was
 * be a stranger. Someone who has to be reminded of your name every morning is
 * not company, whatever else it can do.
 *
 * Two kinds of thing are kept, and they age differently. What the user *is* —
 * their name, that they are on Windows, that they build a desktop app in the
 * evenings — is small, slow-moving, and worth putting in front of the model
 * every time. What was *said* is large and mostly stale, so only a line or two
 * per past conversation survives, and only the most recent handful of those.
 *
 * Everything here is plain data with no I/O, so the shape can be tested and the
 * instructions it produces can be read without starting a conversation.
 */

/** One thing the user said about themselves that is worth keeping. */
export type VoiceMemoryFact = {
  id: string;
  text: string;
  /** When it was learned, as an ISO timestamp. */
  at: string;
};

/** What is left of one past conversation. */
export type VoiceMemorySession = {
  id: string;
  at: string;
  /** A sentence or two: what was talked about, and anything that was decided. */
  summary: string;
};

export type VoiceMemory = {
  /**
   * What to call the user, in their own words.
   *
   * Not necessarily their name. "Boss", "captain", a nickname, or a name in a
   * different script from the interface language — the point is that they chose
   * it, so it is stored as given rather than parsed into first and last.
   */
  addressAs: string;
  facts: readonly VoiceMemoryFact[];
  sessions: readonly VoiceMemorySession[];
  /**
   * Whether the first conversation has happened.
   *
   * Set once the assistant has introduced itself and asked who it is talking to,
   * so the questions are asked on the first run and never again.
   */
  introduced: boolean;
};

export const EMPTY_VOICE_MEMORY: VoiceMemory = {
  addressAs: '',
  facts: [],
  sessions: [],
  introduced: false,
};

/**
 * How many facts are kept.
 *
 * Bounded because every one of them is sent with every turn of every
 * conversation, and a memory that grows without limit turns into a prompt that
 * costs more than the answer. Generous enough that a year of small details fits.
 */
export const MAX_MEMORY_FACTS = 40;

/**
 * How many past conversations are remembered at all.
 *
 * Far fewer than the facts, because the interesting parts of a conversation
 * should have become facts. This is for continuity — "yesterday you were stuck
 * on the installer" — and eight is more than anyone refers back to out loud.
 */
export const MAX_MEMORY_SESSIONS = 8;

/** How long one remembered line may be, so a rambling model cannot fill memory. */
export const MAX_MEMORY_TEXT = 240;

/** How long a chosen form of address may be. A name, not a paragraph. */
export const MAX_ADDRESS_LENGTH = 48;

const clean = (value: unknown, limit: number): string =>
  typeof value === 'string' ? value.replaceAll(/\s+/g, ' ').trim().slice(0, limit) : '';

const isoOrNow = (value: unknown): string => {
  if (typeof value !== 'string') return new Date().toISOString();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
};

/**
 * Repairs whatever was on disk into something usable.
 *
 * Written by a model through a tool call and read back a version later, so it is
 * treated as untrusted input: a corrupt or half-written memory must degrade to
 * an emptier one rather than stop the user talking to their computer.
 */
export const sanitizeVoiceMemory = (stored: unknown): VoiceMemory => {
  if (stored === null || typeof stored !== 'object') return EMPTY_VOICE_MEMORY;
  const record = stored as Partial<Record<keyof VoiceMemory, unknown>>;

  const facts = Array.isArray(record.facts) ? record.facts : [];
  const sessions = Array.isArray(record.sessions) ? record.sessions : [];

  return {
    addressAs: clean(record.addressAs, MAX_ADDRESS_LENGTH),
    facts: facts
      .map((entry, index): VoiceMemoryFact => {
        const item = (entry ?? {}) as Record<string, unknown>;
        return {
          id: clean(item.id, 64) || `fact-${index}`,
          text: clean(item.text, MAX_MEMORY_TEXT),
          at: isoOrNow(item.at),
        };
      })
      .filter((fact) => fact.text.length > 0)
      .slice(-MAX_MEMORY_FACTS),
    sessions: sessions
      .map((entry, index): VoiceMemorySession => {
        const item = (entry ?? {}) as Record<string, unknown>;
        return {
          id: clean(item.id, 64) || `session-${index}`,
          at: isoOrNow(item.at),
          summary: clean(item.summary, MAX_MEMORY_TEXT),
        };
      })
      .filter((session) => session.summary.length > 0)
      .slice(-MAX_MEMORY_SESSIONS),
    introduced: record.introduced === true,
  };
};

/**
 * Adds something learned, without letting the same thing be learned twice.
 *
 * A model told "remember I use Windows" three times in one conversation calls
 * the tool three times, and a memory full of one fact is a memory with room for
 * nothing else. Matching is on the text with case and punctuation ignored, which
 * catches the repeats that actually happen without pretending to understand
 * whether two different sentences mean the same thing.
 */
export const rememberFact = (memory: VoiceMemory, text: string): VoiceMemory => {
  const line = clean(text, MAX_MEMORY_TEXT);
  if (line.length === 0) return memory;

  const key = (value: string): string => value.toLowerCase().replaceAll(/[^\p{L}\p{N} ]/gu, '');
  const kept = memory.facts.filter((fact) => key(fact.text) !== key(line));

  return {
    ...memory,
    facts: [...kept, { id: crypto.randomUUID(), text: line, at: new Date().toISOString() }].slice(-MAX_MEMORY_FACTS),
  };
};

/** Drops what the user asked to be forgotten, matched loosely on the words in it. */
export const forgetFact = (memory: VoiceMemory, about: string): VoiceMemory => {
  const needle = clean(about, MAX_MEMORY_TEXT).toLowerCase();
  if (needle.length === 0) return memory;
  const words = needle.split(' ').filter((word) => word.length > 2);
  return {
    ...memory,
    facts: memory.facts.filter((fact) => {
      const text = fact.text.toLowerCase();
      if (text.includes(needle)) return false;
      return !(words.length > 0 && words.every((word) => text.includes(word)));
    }),
  };
};

/** Keeps what one conversation came to, oldest dropped first. */
export const rememberSession = (memory: VoiceMemory, summary: string): VoiceMemory => {
  const line = clean(summary, MAX_MEMORY_TEXT);
  if (line.length === 0) return memory;
  return {
    ...memory,
    sessions: [...memory.sessions, { id: crypto.randomUUID(), at: new Date().toISOString(), summary: line }].slice(
      -MAX_MEMORY_SESSIONS
    ),
  };
};

/** Records what the user asked to be called. */
export const rememberAddress = (memory: VoiceMemory, addressAs: string): VoiceMemory => ({
  ...memory,
  addressAs: clean(addressAs, MAX_ADDRESS_LENGTH),
});

/**
 * How long ago, in words a model can put in a sentence.
 *
 * A raw timestamp reaches the model as "2026-08-04T19:02:11.000Z" and comes back
 * out of it read aloud, digit by digit. What is actually wanted is the thing a
 * person would say — "the day before yesterday" — so the arithmetic is done here
 * where it can be tested.
 */
export const describeAge = (at: string, now: number = Date.now()): string => {
  const then = Date.parse(at);
  if (Number.isNaN(then)) return 'at some point';
  const days = Math.floor((now - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
};

/**
 * What the model is told it already knows, as prose rather than as a record.
 *
 * Given a JSON blob, these models quote it: "according to my records, your name
 * is Serhan". Given sentences, they use them the way a person uses something
 * they remember. So the memory is rendered as English statements, and the rule
 * about not reciting it is stated next to them rather than somewhere else in the
 * prompt where it would be a page away from the temptation.
 */
export const buildMemoryInstructions = (memory: VoiceMemory, now: number = Date.now()): string => {
  if (!memory.introduced) {
    return `# This is the first time you have met
You have never spoken to this person before and you know nothing about them.

- Say hello, say who you are in one short sentence, and ask what they would like to be called. Ask that first, before anything else.
- When they answer, call \`app_remember\` with \`callMe\` set to exactly what they said, and use it from your very next sentence.
- Then ask one or two things worth knowing — what they are working on, what they would like you to help with — and keep the answers with \`app_remember\`. One question at a time, and stop asking the moment they want to talk about something else.
- Do not interview them. This is a hello, not a form.`;
  }

  const lines: string[] = ['# What you already know about them'];

  if (memory.addressAs.length > 0) {
    lines.push(
      `They asked to be called ${memory.addressAs}. Use it — not in every sentence, but the way you would use a friend's name.`
    );
  }

  if (memory.facts.length > 0) {
    lines.push('', 'Things they have told you:');
    for (const fact of memory.facts) lines.push(`- ${fact.text}`);
  }

  if (memory.sessions.length > 0) {
    lines.push('', 'What you have talked about before:');
    for (const session of memory.sessions) lines.push(`- ${describeAge(session.at, now)}: ${session.summary}`);
  }

  lines.push(
    '',
    'Use this the way a person uses something they remember: it shapes what you say, and you do not announce that you remember it. Never read this list back, never say "according to my notes", and never open with a summary of what you know about them.',
    'When they tell you something worth keeping — what they are called, what they are working on, how they like things done — call `app_remember` and carry on talking. Say at most a few words about having noted it.',
    'If anything here turns out to be wrong or out of date, call `app_remember` with the correction, or `app_forget` if it should simply go.'
  );

  return lines.join('\n');
};
