/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Turning something the user taught into a skill the app can actually install.
 *
 * There were already two ways to keep what somebody taught, and both stop short.
 * A fact goes in `user.md`; a procedure goes in `agent.md` and is followed by
 * the assistant that was told it. Neither produces a *skill* — a folder with a
 * `SKILL.md` in it, in the library, available to every agent and to a
 * conversation that was never part of the one where it was learned.
 *
 * This is the part of that which is text, so it can be tested without a screen:
 * the folder name, the front matter, the body, and the brief handed to the agent
 * that writes the real thing. The capture and the install live elsewhere.
 *
 * Deliberately a *draft*. What is written here is a first version from what the
 * user said and, when they showed it, a storyboard of what they did; the agent
 * that installs it is expected to improve on it, because it can open the frames
 * and this cannot.
 */

/** What the user told the assistant about the thing they are teaching. */
export type SkillDraft = {
  /** What they call it. Becomes the skill's name and its folder. */
  name: string;
  /** What it is for, in a sentence: this is what decides when it is reached for. */
  what: string;
  /** How it is done, in their words. */
  steps: string;
};

/** A recorded demonstration, when there was one. */
export type SkillRecordingSummary = {
  folder: string;
  frames: readonly { file: string; at: number }[];
  seconds: number;
};

export const MAX_SKILL_NAME = 48;
export const MAX_SKILL_TEXT = 2000;

const tidy = (value: string, limit: number): string => value.replaceAll(/\s+/g, ' ').trim().slice(0, limit);

/**
 * The folder a skill lives in, from what the user called it.
 *
 * Lower case, hyphenated and letters-and-digits only, because this becomes a
 * directory on three operating systems and the name arrived through a
 * microphone — "Fatura Gönder!" has to survive being a path.
 */
export const skillSlug = (name: string): string => {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, MAX_SKILL_NAME);
  return cleaned.length > 0 ? cleaned : 'taught-skill';
};

/** Whether there is enough here to write a skill from. */
export const isDraftUsable = (draft: SkillDraft): boolean =>
  tidy(draft.name, MAX_SKILL_NAME).length > 0 && tidy(draft.steps, MAX_SKILL_TEXT).length > 0;

/**
 * The skill as a first draft, in the shape the loader expects.
 *
 * The description is the only part that decides whether the skill is ever
 * reached for, so it is built from what the user said it is *for* rather than
 * from its name — a skill called "Invoice" tells a model nothing about when to
 * use it, and "Use when the user asks to send an invoice to a client" tells it
 * everything.
 */
export const buildSkillDraft = (draft: SkillDraft, recording?: SkillRecordingSummary): string => {
  const name = skillSlug(draft.name);
  const title = tidy(draft.name, MAX_SKILL_NAME);
  const what = tidy(draft.what, MAX_SKILL_TEXT);
  const steps = tidy(draft.steps, MAX_SKILL_TEXT);

  const description =
    what.length > 0 ? `${what} Taught by the user, in their own words.` : `${title}, as taught by the user.`;

  const lines = [
    '---',
    `name: ${name}`,
    `description: ${description.replaceAll('\n', ' ')}`,
    '---',
    '',
    `# ${title}`,
    '',
    'This is the user’s own way of doing this. They took the trouble to teach it, which means their',
    'way is the right way here even where another would work — follow it rather than solving the',
    'problem again from scratch.',
    '',
    '## When to use it',
    '',
    what.length > 0 ? what : `When the user asks for ${title.toLowerCase()}.`,
    '',
    '## How they do it',
    '',
    steps,
  ];

  if (recording && recording.frames.length > 0) {
    lines.push(
      '',
      '## What it looks like',
      '',
      `They recorded themselves doing it — ${recording.frames.length} screenshots over ${recording.seconds} seconds, in \`frames/\`.`,
      'Open them in order before following the steps: they show which window, which menu and which of',
      'the several buttons that look alike.'
    );
  }

  return `${lines.join('\n')}\n`;
};

/**
 * What the agent is asked to do with all this.
 *
 * The assistant holding the conversation writes the draft because it heard the
 * explanation; the agent installs it because it has hands and can look at the
 * frames. Saying that split out loud in the brief matters — an agent told only
 * "make a skill" writes a new one from the title and throws away what the user
 * actually said.
 */
export const buildSkillBrief = (draft: SkillDraft, folder: string, recording?: SkillRecordingSummary): string => {
  const slug = skillSlug(draft.name);
  const skillFolder = `${folder.replaceAll('\\', '/')}/skill`;

  const lines = [
    `Install a skill the user has just taught, called "${tidy(draft.name, MAX_SKILL_NAME)}".`,
    '',
    `A first draft is already written at ${skillFolder}/SKILL.md. Read it first. It came from what the`,
    'user said out loud, so its content is the requirement — improve the wording, do not replace the',
    'method with your own.',
  ];

  if (recording && recording.frames.length > 0) {
    lines.push(
      '',
      `They also recorded themselves doing it: ${recording.frames.length} screenshots in ${folder.replaceAll('\\', '/')}/frames,`,
      'named in order. Look at them. Name the actual applications, windows, menus and buttons you can',
      'see, and put those names in the steps — that specificity is the whole difference between a skill',
      'that works and a paraphrase of the obvious. Anything you cannot make out, leave out rather than',
      'guessing at it.',
      '',
      'If the frames show a password, a card number, a private message or anything else that is plainly',
      'not meant to be kept, do not write it down and say that you left it out.'
    );
  }

  lines.push(
    '',
    'Then install it:',
    '',
    '```bash',
    `"$FOOL_HELPER_BIN" config skills import <<'JSON'`,
    `{ "skill_path": "${skillFolder}" }`,
    'JSON',
    '```',
    '',
    `Report back in one sentence: the skill's name, and whether the import succeeded. Do not report`,
    'success unless the command said so.',
    '',
    `The folder is ${skillFolder}; the skill's name is ${slug}.`
  );

  return lines.join('\n');
};
