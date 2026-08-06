/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the assistant remembers, as two files the user can read.
 *
 * Every session started from nothing: the assistant was told who it was and
 * nothing about who it was talking to, so the first thing it did each time was
 * be a stranger. Someone who has to be reminded of your name every morning is
 * not company, whatever else it can do.
 *
 * The first version of this kept a JSON record, which works right up until you
 * try to show it to the person it is about. A record has to be rendered to be
 * read and parsed to be changed, so the user could see a view of their own
 * memory but never the thing itself, and never a place to correct it by hand. So
 * it is two markdown documents instead, and the settings page shows them as they
 * are:
 *
 * - **user.md** — who they are, what to call them, what their own words mean,
 *   and a line about each conversation that happened.
 * - **agent.md** — what the assistant got wrong and what it took from that, plus
 *   the skills they have taught it by saying them out loud.
 *
 * They are different in kind, which is why they are separate files. The first is
 * about a person and only they can say whether it is right. The second is about
 * the assistant's own work, and it is the part that makes it better next week
 * than it was this week.
 *
 * Everything here is plain data with no I/O, so the shape can be tested and the
 * instructions it produces can be read without starting a conversation.
 */

import {
  appendToSection,
  clampMemoryDoc,
  memoryLine,
  readNamedBlocks,
  readSection,
  removeMatchingLines,
  removeNamedBlock,
  setOnlyBullet,
  upsertNamedBlock,
} from './memoryDoc';

export type VoiceMemory = {
  /** user.md — who they are and what has been said. */
  user: string;
  /** agent.md — lessons taken from mistakes, and skills they taught. */
  agent: string;
  /**
   * Whether the first conversation has happened.
   *
   * Set once the assistant has introduced itself and asked who it is talking to,
   * so the questions are asked on the first run and never again. Kept beside the
   * documents rather than in them because it is a fact about the app, not about
   * the user, and a document they cleared should not start an interview.
   */
  introduced: boolean;
};

/**
 * The headings the tools write under.
 *
 * Named here rather than typed at each call site because they are the contract
 * between what the assistant writes and what the user reads: rename one and the
 * next thing learned lands in a new section beneath the old one, which looks to
 * the user like the memory forgetting where it put things.
 */
export const MEMORY_SECTIONS = {
  address: 'What to call you',
  facts: 'What I know about you',
  meanings: 'What your words mean',
  sessions: 'What we have talked about',
  lessons: 'Lessons I have learned',
  skills: 'Skills you taught me',
} as const;

/** How many bullets a section carries before the oldest start falling off. */
const SECTION_LIMITS = {
  facts: 60,
  meanings: 40,
  sessions: 12,
  lessons: 40,
} as const;

export const DEFAULT_USER_DOC = `# About you

This is what I remember about you. Edit it freely — I read it before every
conversation, and so does any agent that works on your behalf.

## ${MEMORY_SECTIONS.address}

## ${MEMORY_SECTIONS.facts}

## ${MEMORY_SECTIONS.meanings}

## ${MEMORY_SECTIONS.sessions}
`;

export const DEFAULT_AGENT_DOC = `# How to work with you

This is what I have learned about doing things for you — what went wrong and what
I took from it, and the skills you have taught me. Edit it freely.

## ${MEMORY_SECTIONS.lessons}

## ${MEMORY_SECTIONS.skills}
`;

export const EMPTY_VOICE_MEMORY: VoiceMemory = {
  user: DEFAULT_USER_DOC,
  agent: DEFAULT_AGENT_DOC,
  introduced: false,
};

/** One thing the user taught, in the shape the tool hands it over. */
export type TaughtSkill = {
  /** What they call it. Becomes the heading it is stored under. */
  name: string;
  /** When it applies, in their words: "when I ask you to find a video". */
  when: string;
  /** What to do, one step per line or one sentence. */
  steps: string;
};

const asDoc = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') return fallback;
  const text = value.replaceAll('\r\n', '\n').trim();
  return text.length === 0 ? fallback : clampMemoryDoc(`${text}\n`);
};

/**
 * Rebuilds the documents from whatever the first version of this stored.
 *
 * A memory written months ago by a shape that no longer exists is still the
 * user's memory, and losing it on an update is exactly the failure this whole
 * feature exists to prevent. So the old record is read once and written out as
 * the document it would have produced, after which nothing looks at it again.
 */
const migrateLegacy = (record: Record<string, unknown>): string | null => {
  const facts = Array.isArray(record.facts) ? record.facts : [];
  const sessions = Array.isArray(record.sessions) ? record.sessions : [];
  const address = memoryLine(record.addressAs);
  if (facts.length === 0 && sessions.length === 0 && address.length === 0) return null;

  let doc = DEFAULT_USER_DOC;
  if (address.length > 0) doc = setOnlyBullet(doc, MEMORY_SECTIONS.address, address);

  for (const entry of facts) {
    const text = memoryLine((entry as { text?: unknown })?.text);
    if (text.length > 0) doc = appendToSection(doc, MEMORY_SECTIONS.facts, text, SECTION_LIMITS.facts);
  }

  for (const entry of sessions) {
    const item = (entry ?? {}) as { at?: unknown; summary?: unknown };
    const summary = memoryLine(item.summary);
    if (summary.length === 0) continue;
    const when = typeof item.at === 'string' && !Number.isNaN(Date.parse(item.at)) ? item.at.slice(0, 10) : 'earlier';
    doc = appendToSection(doc, MEMORY_SECTIONS.sessions, `${when} — ${summary}`, SECTION_LIMITS.sessions);
  }

  return doc;
};

/**
 * Repairs whatever was on disk into something usable.
 *
 * Written by a model through a tool call, edited by hand in a settings page, and
 * read back a version later, so it is treated as untrusted input: a corrupt or
 * half-written memory must degrade to an emptier one rather than stop the user
 * talking to their computer.
 */
export const sanitizeVoiceMemory = (stored: unknown): VoiceMemory => {
  if (stored === null || typeof stored !== 'object') return EMPTY_VOICE_MEMORY;
  const record = stored as Record<string, unknown>;

  return {
    user: asDoc(record.user, migrateLegacy(record) ?? DEFAULT_USER_DOC),
    agent: asDoc(record.agent, DEFAULT_AGENT_DOC),
    introduced: record.introduced === true,
  };
};

const editUser = (memory: VoiceMemory, change: (doc: string) => string): VoiceMemory => ({
  ...memory,
  user: clampMemoryDoc(change(memory.user)),
});

const editAgent = (memory: VoiceMemory, change: (doc: string) => string): VoiceMemory => ({
  ...memory,
  agent: clampMemoryDoc(change(memory.agent)),
});

/** Keeps something they said about themselves, without keeping it twice. */
export const rememberFact = (memory: VoiceMemory, text: string): VoiceMemory =>
  editUser(memory, (doc) => appendToSection(doc, MEMORY_SECTIONS.facts, text, SECTION_LIMITS.facts));

/**
 * Keeps what one of their own words means.
 *
 * Kept apart from the facts because it is used differently: a fact colours what
 * the assistant says, and a meaning has to be substituted before it can act at
 * all. "Put it on my desktop" is not a request anything can carry out until
 * "desktop" resolves to a path, and the agent doing the carrying is a different
 * process that has never heard the user say it.
 */
export const rememberMeaning = (memory: VoiceMemory, word: string, means: string): VoiceMemory => {
  const term = memoryLine(word);
  const meaning = memoryLine(means);
  if (term.length === 0 || meaning.length === 0) return memory;
  return editUser(memory, (doc) =>
    appendToSection(doc, MEMORY_SECTIONS.meanings, `"${term}" — ${meaning}`, SECTION_LIMITS.meanings)
  );
};

/** Drops what the user asked to be forgotten, matched loosely on the words in it. */
export const forgetFact = (memory: VoiceMemory, about: string): VoiceMemory =>
  editUser(memory, (doc) => removeMatchingLines(doc, about));

/**
 * Keeps what one conversation came to.
 *
 * Dated rather than described, because a phrase like "yesterday" written into a
 * file is wrong by the following morning. The date stays as a date and today's
 * is stated at the top of the prompt, so the model does the arithmetic with
 * current information instead of reading a stale answer.
 */
export const rememberSession = (memory: VoiceMemory, summary: string, at: Date = new Date()): VoiceMemory => {
  const line = memoryLine(summary);
  if (line.length === 0) return memory;
  const day = Number.isNaN(at.getTime()) ? new Date() : at;
  return editUser(memory, (doc) =>
    appendToSection(
      doc,
      MEMORY_SECTIONS.sessions,
      `${day.toISOString().slice(0, 10)} — ${line}`,
      SECTION_LIMITS.sessions
    )
  );
};

/**
 * Records what the user asked to be called.
 *
 * Not necessarily their name. "Boss", "captain", a nickname, or a name in a
 * different script from the interface language — the point is that they chose
 * it, so it is stored as given rather than parsed into first and last.
 */
export const rememberAddress = (memory: VoiceMemory, addressAs: string): VoiceMemory =>
  editUser(memory, (doc) => setOnlyBullet(doc, MEMORY_SECTIONS.address, addressAs));

/** What they are called right now, read back out of the document. */
export const readAddress = (memory: VoiceMemory): string => readSection(memory.user, MEMORY_SECTIONS.address)[0] ?? '';

/**
 * Writes down something that went wrong, and what to do instead.
 *
 * This is the half of memory that is about the assistant rather than about the
 * user, and it is the only thing here that makes tomorrow better than today: a
 * mistake that is not written down is one it is free to make again next week,
 * with the same confidence and the same apology.
 */
export const learnLesson = (memory: VoiceMemory, lesson: string): VoiceMemory =>
  editAgent(memory, (doc) => appendToSection(doc, MEMORY_SECTIONS.lessons, lesson, SECTION_LIMITS.lessons));

/** Keeps a skill the user taught, replacing an earlier version of the same one. */
export const learnSkill = (memory: VoiceMemory, skill: TaughtSkill): VoiceMemory => {
  const name = memoryLine(skill.name);
  const steps = memoryLine(skill.steps);
  if (name.length === 0 || steps.length === 0) return memory;

  const when = memoryLine(skill.when);
  return editAgent(memory, (doc) =>
    upsertNamedBlock(doc, MEMORY_SECTIONS.skills, name, [...(when.length > 0 ? [`When: ${when}`] : []), `Do: ${steps}`])
  );
};

/** Drops a taught skill by whatever the user calls it. */
export const forgetSkill = (memory: VoiceMemory, name: string): VoiceMemory =>
  editAgent(memory, (doc) => removeNamedBlock(doc, MEMORY_SECTIONS.skills, name));

/** The names of everything they have taught, for a settings page to list. */
export const listSkills = (memory: VoiceMemory): string[] => readNamedBlocks(memory.agent, MEMORY_SECTIONS.skills);

/** Drops a lesson, matched the way the user would refer to it. */
export const forgetLesson = (memory: VoiceMemory, about: string): VoiceMemory =>
  editAgent(memory, (doc) => removeMatchingLines(doc, about));

/** Whether a document says anything beyond the headings it shipped with. */
const hasContent = (doc: string): boolean =>
  doc.split('\n').some((line) => /^\s*[-*]\s+\S/.test(line) || /^\s*###\s+\S/.test(line));

/**
 * What an agent is handed along with the job.
 *
 * The agent that opens the browser and types is a different process with a
 * different model and no history at all, and the request reaching it is one
 * sentence the user said out loud. "Put it on my desktop" is not a task anything
 * can carry out unless it knows what they mean by desktop, and the only place
 * that is written down is here.
 *
 * So the memory goes with the work. Kept short deliberately — an agent is being
 * given a job, not introduced to a person, and burying a one-line task under two
 * pages of context is its own kind of failure. When there is nothing worth
 * saying, the request goes on its own rather than under an empty heading.
 */
export const buildAgentBriefing = (memory: VoiceMemory, request: string): string => {
  const task = request.trim();
  const known = [memory.user, memory.agent].filter((doc) => hasContent(doc));
  if (known.length === 0) return task;

  return [
    '<user-memory>',
    'What The Fool knows about the person who asked for this. Use it to read the request the way they meant it — their own words for places, people and projects are in here, and a word like "desktop" means whatever this says it means. Follow anything under "Skills you taught me" as a standing instruction. Do not mention this block to them.',
    '',
    ...known.map((doc) => doc.trim()),
    '</user-memory>',
    '',
    task,
  ].join('\n');
};

/**
 * What the model is told it already knows.
 *
 * The documents go in as they are rather than as a summary of them. They were
 * written to be read — by the user in a settings page and by a model in a prompt
 * — and rewriting them here would mean the assistant acts on something the user
 * cannot see, which is the failure this design was meant to remove.
 *
 * The rule about not reciting them is stated next to them rather than somewhere
 * else in the prompt, where it would be a page away from the temptation.
 */
export const buildMemoryInstructions = (memory: VoiceMemory, now: Date = new Date()): string => {
  if (!memory.introduced) {
    return `# This is the first time you have met
You have never spoken to this person before and you know nothing about them.

- Say hello, say who you are in one short sentence, and ask what they would like to be called. Ask that first, before anything else.
- When they answer, call \`app_remember\` with \`callMe\` set to exactly what they said, and use it from your very next sentence.
- Then ask one or two things worth knowing — what they are working on, what they would like you to help with — and keep the answers with \`app_remember\`. One question at a time, and stop asking the moment they want to talk about something else.
- Do not interview them. This is a hello, not a form.`;
  }

  const today = Number.isNaN(now.getTime()) ? new Date() : now;
  const sections: string[] = [
    `# What you already know
Today is ${today.toISOString().slice(0, 10)}. Dates below are written as dates; work out "yesterday" and "last week" yourself.`,
  ];

  if (hasContent(memory.user)) sections.push(`## user.md\n\n${memory.user.trim()}`);
  if (hasContent(memory.agent)) sections.push(`## agent.md\n\n${memory.agent.trim()}`);

  sections.push(
    [
      '## How to use these',
      'Use them the way a person uses something they remember: they shape what you say, and you do not announce that you remember them. Never read them back, never say "according to my notes", and never open with a summary of what you know about them.',
      'What is under "What your words mean" is not trivia — it is how their sentences are to be read. When they use one of those words, substitute what it means before you act, and pass the meaning on to any agent you hand work to, because that agent has never heard them say it.',
      'Everything under "Skills you taught me" is a standing instruction. When one of them applies, follow it as written rather than working the request out again from scratch — they taught it because your own way of doing it was not what they wanted.',
      'When they tell you something worth keeping — what they are called, what they are working on, how they like things done, what one of their words means — call `app_remember` and carry on talking. Say at most a few words about having noted it.',
      'When you get something wrong and they put you right, call `app_learn` with what you now know, in one sentence, phrased as what to do next time. Do this without being asked; being told the same thing twice is the thing they will remember about you.',
      'If anything here turns out to be wrong or out of date, call `app_remember` with the correction, or `app_forget` if it should simply go.',
    ].join('\n')
  );

  return sections.join('\n\n');
};
