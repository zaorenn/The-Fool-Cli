/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  ASIDE_NAME_MAX,
  chooseVariant,
  STEP_WORDS_MAX,
  worthSaying,
  BETWEEN_ASIDES_MS,
  FIRST_GAP_MS,
  MAX_FILLERS,
  QUIET_BEFORE_FIRST_WORD_MS,
  QUIET_BEFORE_ASIDE_MS,
  VARIANTS_PER_KIND,
  fillerFor,
  fillerKey,
  gapBefore,
  mayMentionAside,
  maySpeakUnprompted,
  shortenForAside,
  AN_HOUR_MS,
  VOLUNTEERED_PER_HOUR,
  type AsideMoment,
  type SilenceContract,
  type ThinkingState,
} from '@/common/voice/thinkingAloud';

const state = (over: Partial<ThinkingState> = {}): ThinkingState => ({
  elapsedMs: 0,
  quietForMs: 0,
  speaking: false,
  toolsRan: 0,
  saidSoFar: 0,
  ...over,
});

describe('when to say something into a silence', () => {
  it('leaves a short pause alone', () => {
    expect(fillerFor(state({ quietForMs: FIRST_GAP_MS - 1 }))).toBeNull();
  });

  /**
   * Not while nothing is being done. Asked "Hello, how are you today?", the
   * assistant replied "One moment. Hmm, let me think. Just a moment." — three
   * of these and no answer. A greeting is not a task, and narrating a wait
   * nobody is in sounds stupid rather than attentive.
   */
  it('leaves a silence alone while no work is happening', () => {
    expect(fillerFor(state({ quietForMs: FIRST_GAP_MS }))).toBeNull();
    expect(fillerFor(state({ quietForMs: QUIET_BEFORE_FIRST_WORD_MS - 1 }))).toBeNull();
  });

  it('says one thing, once, when a turn with no work has genuinely stalled', () => {
    expect(fillerFor(state({ quietForMs: QUIET_BEFORE_FIRST_WORD_MS }))).toBe('thinking');
    // And never a second time: that is the three-in-a-row the user heard.
    expect(fillerFor(state({ quietForMs: 600_000, saidSoFar: 1 }))).toBeNull();
  });

  it('fills the first long gap once work is under way', () => {
    expect(fillerFor(state({ quietForMs: FIRST_GAP_MS, toolsRan: 1 }))).toBe('working');
  });

  /// A filler over the top of an answer is worse than any silence it could
  /// have covered.
  it('never speaks over real speech', () => {
    expect(fillerFor(state({ quietForMs: 60_000, speaking: true }))).toBeNull();
  });

  it('stops rather than nagging', () => {
    expect(fillerFor(state({ quietForMs: 600_000, saidSoFar: MAX_FILLERS }))).toBeNull();
  });

  it('waits longer each time', () => {
    expect(gapBefore(0)).toBe(FIRST_GAP_MS);
    expect(gapBefore(1)).toBeGreaterThan(gapBefore(0));
    expect(gapBefore(2)).toBeGreaterThan(gapBefore(1));
    expect(gapBefore(3)).toBeGreaterThan(gapBefore(2));
  });

  it('does not fill the second gap at the first gap’s length', () => {
    expect(fillerFor(state({ quietForMs: FIRST_GAP_MS + 100, saidSoFar: 1 }))).toBeNull();
    expect(fillerFor(state({ quietForMs: gapBefore(1), saidSoFar: 1, toolsRan: 1 }))).toBe('working');
  });
});

describe('what it says', () => {
  /// Before anything has happened there is nothing true to report, so it is a
  /// sound rather than a sentence.
  it('is a sound before any tool has run, once the wait is genuinely long', () => {
    expect(fillerFor(state({ quietForMs: QUIET_BEFORE_FIRST_WORD_MS, toolsRan: 0 }))).toBe('thinking');
  });

  it('is about the work once there is work', () => {
    expect(fillerFor(state({ quietForMs: FIRST_GAP_MS, toolsRan: 2 }))).toBe('working');
  });

  it('admits it is taking a while once it is', () => {
    expect(fillerFor(state({ quietForMs: gapBefore(1), saidSoFar: 1, toolsRan: 2, elapsedMs: 45_000 }))).toBe('still');
  });
});

describe('which line', () => {
  /// The same sentence three times is worse than silence — it is what a
  /// machine sounds like.
  it('has a distinct line for every variant', () => {
    const keys = Array.from({ length: VARIANTS_PER_KIND }, (_, n) => fillerKey('thinking', n));
    expect(new Set(keys).size).toBe(VARIANTS_PER_KIND);
  });

  it('comes back round after the last variant', () => {
    expect(fillerKey('working', VARIANTS_PER_KIND)).toBe(fillerKey('working', 0));
  });

  it('names a key under the voice settings, where the rest of the spoken lines are', () => {
    expect(fillerKey('still', 0)).toBe('settings.voice.thinkingAloud.still.0');
  });
});

/**
 * An aside is an interruption, so it owes the room more than a filler does.
 *
 * A filler covers a silence the assistant itself made. This walks into one
 * nobody asked it to fill, which is why every one of these is a refusal.
 */
const moment = (over: Partial<AsideMoment> = {}): AsideMoment => ({
  phase: 'listening',
  standby: false,
  quietForMs: QUIET_BEFORE_ASIDE_MS,
  sinceLastAsideMs: Number.POSITIVE_INFINITY,
  ...over,
});

describe('mentioning a finished task', () => {
  it('takes a long enough gap in a listening conversation', () => {
    expect(mayMentionAside(moment())).toBe(true);
  });

  it('refuses over an answer', () => {
    expect(mayMentionAside(moment({ phase: 'speaking' }))).toBe(false);
  });

  it('refuses over the user', () => {
    expect(mayMentionAside(moment({ phase: 'hearing' }))).toBe(false);
  });

  it('refuses while it has been told to wait', () => {
    expect(mayMentionAside(moment({ standby: true }))).toBe(false);
  });

  it('refuses in a pause too short to walk into', () => {
    expect(mayMentionAside(moment({ quietForMs: QUIET_BEFORE_ASIDE_MS - 1 }))).toBe(false);
  });

  /// Two tasks finishing while a third is discussed is the normal case once
  /// delegating is cheap, and back to back they are one unreadable sentence.
  it('refuses on top of the previous aside', () => {
    expect(mayMentionAside(moment({ sinceLastAsideMs: BETWEEN_ASIDES_MS - 1 }))).toBe(false);
    expect(mayMentionAside(moment({ sinceLastAsideMs: BETWEEN_ASIDES_MS }))).toBe(true);
  });
});

describe('naming the task that finished', () => {
  it('leaves a short request alone', () => {
    expect(shortenForAside('back up the photos')).toBe('back up the photos');
  });

  it('collapses the whitespace a transcript arrives with', () => {
    expect(shortenForAside('back  up\n the photos')).toBe('back up the photos');
  });

  /// Read back in full, a long request is not a reminder — it is the task
  /// again, and by then the user has stopped listening.
  it('shortens a long one at a word boundary', () => {
    const long = 'open Discord and tell Ali I am running twenty minutes late and will bring the drive';
    const short = shortenForAside(long);
    expect(short.length).toBeLessThanOrEqual(ASIDE_NAME_MAX + 1);
    expect(short.endsWith('…')).toBe(true);
    expect(long.startsWith(short.slice(0, -1))).toBe(true);
  });
});

/**
 * The same three sentences, always in the same order.
 *
 * That is what the rotation produced, and it is what the user heard: a pattern
 * learned by the second conversation, which sounds like a machine pretending
 * not to be one. Chosen instead — and never the same twice running, because the
 * repeat is the only thing anybody notices.
 */
describe('choosing which line to say', () => {
  it('never says the same one twice running', () => {
    for (let previous = 0; previous < VARIANTS_PER_KIND; previous += 1) {
      for (let step = 0; step < 40; step += 1) {
        const chosen = chooseVariant(previous, step / 40);
        expect(chosen, `previous ${previous} at roll ${step / 40}`).not.toBe(previous);
        expect(chosen).toBeGreaterThanOrEqual(0);
        expect(chosen).toBeLessThan(VARIANTS_PER_KIND);
      }
    }
  });

  it('can reach every other line, so none of them is dead', () => {
    const reachable = new Set(Array.from({ length: 40 }, (_, step) => chooseVariant(2, step / 40)));
    expect(reachable).toEqual(new Set([0, 1, 3, 4]));
  });

  it('takes the whole range when nothing has been said yet', () => {
    const reachable = new Set(Array.from({ length: 40 }, (_, step) => chooseVariant(-1, step / 40)));
    expect(reachable.size).toBe(VARIANTS_PER_KIND);
  });

  /// A roll of exactly 1 is not what Math.random returns, but a caller passing
  /// one must not produce a key that names a line nobody wrote.
  it('stays in range at the very top of the roll', () => {
    expect(chooseVariant(-1, 1)).toBeLessThan(VARIANTS_PER_KIND);
    expect(chooseVariant(0, 1)).toBeLessThan(VARIANTS_PER_KIND);
  });
});

/**
 * Saying what it is doing, when what it is doing is worth saying.
 *
 * A tool's own name read aloud — "browser_navigate" — is worse than "still on
 * it": ugly, and meaningless to the person hearing it.
 */
describe('whether a step can be said out loud', () => {
  it('says a phrase a person would use', () => {
    expect(worthSaying('reading the third result')).toBe(true);
    expect(worthSaying('opening the browser')).toBe(true);
  });

  it('refuses a machine name', () => {
    expect(worthSaying('browser_navigate')).toBe(false);
    expect(worthSaying('mcp.playwright.click')).toBe(false);
    expect(worthSaying('readFileSync')).toBe(false);
  });

  it('refuses nothing, and refuses a paragraph', () => {
    expect(worthSaying('   ')).toBe(false);
    expect(worthSaying('a'.repeat(STEP_WORDS_MAX + 1))).toBe(false);
  });

  /// A single ordinary word is a phrase, not an identifier.
  it('allows a plain word', () => {
    expect(worthSaying('searching')).toBe(true);
  });
});

/**
 * The door everything unprompted goes through.
 *
 * Written before anything that speaks unprompted exists. Every proactive
 * assistant that has been switched off was switched off for the same reason: the
 * rules about staying quiet were added one at a time, after each complaint, and
 * by then the user had already decided.
 */
describe('speaking when nobody asked', () => {
  /** A moment in which everything is as permissive as it gets. */
  const open: SilenceContract = {
    reason: 'curiosity',
    about: 'working-hours',
    enabled: true,
    hushed: false,
    phase: 'listening',
    standby: false,
    holdingToTalk: false,
    userIsTyping: false,
    quietForMs: 30_000,
    sinceVolunteeredMs: Number.POSITIVE_INFINITY,
    volunteeredInLastHour: 0,
    alreadySaid: new Set<string>(),
  };

  const why = (contract: SilenceContract): string => {
    const verdict = maySpeakUnprompted(contract);
    return verdict.speak === false ? verdict.because : '';
  };

  it('speaks when every rule is satisfied', () => {
    expect(maySpeakUnprompted(open).speak).toBe(true);
  });

  it('says nothing at all when the setting is off', () => {
    expect(maySpeakUnprompted({ ...open, enabled: false }).speak).toBe(false);
  });

  /// It has to work when said out loud, in the moment, without anybody opening
  /// a settings page. An assistant that cannot be hushed by saying "be quiet"
  /// gets closed instead.
  it('stays quiet for the session once told to', () => {
    expect(why({ ...open, hushed: true })).toContain('quiet');
  });

  it('never speaks over somebody who is mid-sentence', () => {
    expect(maySpeakUnprompted({ ...open, holdingToTalk: true }).speak).toBe(false);
    expect(maySpeakUnprompted({ ...open, userIsTyping: true }).speak).toBe(false);
  });

  it('waits for a gap rather than talking over the conversation', () => {
    expect(maySpeakUnprompted({ ...open, phase: 'speaking' }).speak).toBe(false);
    expect(maySpeakUnprompted({ ...open, standby: true }).speak).toBe(false);
    expect(maySpeakUnprompted({ ...open, quietForMs: 0 }).speak).toBe(false);
  });

  /// The rule that matters most, and the one invisible to whoever wrote the
  /// feature — they only ever see the first time.
  it('never volunteers the same thing twice', () => {
    expect(why({ ...open, alreadySaid: new Set(['working-hours']) })).toContain('already said');
  });

  it('holds a volunteered remark to one an hour', () => {
    expect(maySpeakUnprompted({ ...open, volunteeredInLastHour: VOLUNTEERED_PER_HOUR }).speak).toBe(false);
    expect(maySpeakUnprompted({ ...open, sinceVolunteeredMs: AN_HOUR_MS - 1 }).speak).toBe(false);
  });

  /// A task the user started and a question they asked are owed to them.
  /// Rationing those by the hour would mean starting three tasks and being told
  /// about one.
  it('does not ration what the user is already waiting for', () => {
    const owed = { ...open, reason: 'task-finished' as const, volunteeredInLastHour: 5, sinceVolunteeredMs: 0 };
    expect(maySpeakUnprompted(owed).speak).toBe(true);
  });

  /// Owed is not a way through the door — it only means the door is not also
  /// rate-limited. Every silence rule still applies.
  it('still refuses an owed remark over somebody talking', () => {
    expect(maySpeakUnprompted({ ...open, reason: 'task-finished', holdingToTalk: true }).speak).toBe(false);
    expect(maySpeakUnprompted({ ...open, reason: 'task-finished', hushed: true }).speak).toBe(false);
    expect(maySpeakUnprompted({ ...open, reason: 'answer-arrived', enabled: false }).speak).toBe(false);
  });

  it('says which rule held, rather than only saying no', () => {
    expect(why({ ...open, phase: 'acting' })).toContain('acting');
  });
});
