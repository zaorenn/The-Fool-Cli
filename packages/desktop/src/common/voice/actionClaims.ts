/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Saying it is done when nothing was done.
 *
 * The persona already carries the rule — "never say you have done something
 * unless a tool told you it was done", stated as the most damaging thing it can
 * do — and the rule does not hold. It was watched saying "Şimdi çalıyor" with
 * an empty activity list behind it: no tool called, nothing playing, and a user
 * who now believes their song is on.
 *
 * That is the failure this exists for, and it cannot be fixed by asking more
 * firmly. A model that has decided it finished a task will say so in whatever
 * words the prompt has not forbidden. So the claim is caught after the sentence
 * is formed and checked against what actually ran that turn.
 *
 * The distinction that matters is **completed** versus **under way**. "I'm
 * opening it now" is what the rules ask for — announce, then call — and a turn
 * that says it and then calls the tool is correct. "It's playing" is a
 * statement about the world, and if no tool ran it is false. Only the second
 * kind is caught here; treating the first as a lie would punish the behaviour
 * the prompt is trying to produce.
 */

/**
 * Claims that the thing is already true.
 *
 * Written as explicit alternations rather than a loose stem match, because the
 * near-misses are all real speech: `açacağım` is a promise, `açayım mı` is a
 * question, and `açtım` is the claim. A pattern relaxed enough to catch every
 * conjugation catches the first two as well, and refusing a question the
 * assistant was right to ask is a worse failure than the one being prevented.
 */
/**
 * Word boundaries that understand the alphabets this app speaks.
 *
 * `\b` is defined against `[A-Za-z0-9_]`, so it does not fire beside `ş`, `ı`,
 * `ü` or any other letter outside ASCII — `/\bşimdi/` matches nothing at all,
 * silently, including at the start of a string. That is not a Turkish problem;
 * it is every locale here except English. Unicode lookarounds instead.
 */
const edged = (body: string): RegExp => new RegExp(`(?<!\\p{L})(?:${body})(?!\\p{L})`, 'iu');

const COMPLETED: readonly RegExp[] = [
  // ── Turkish ──────────────────────────────────────────────────────────────
  // Playing, in the sense of "it is playing now".
  edged('(şimdi|şu ?an(da)?|artık)\\s+çal[ıi]yor'),
  edged('çalmaya başladı'),
  edged('oynatmaya başladım'),
  // First person past: opened, sent, did, saved, downloaded, installed, set up.
  edged('açtım|gönderdim|yaptım|hallettim|kaydettim|indirdim|kurdum|başlattım|ayarladım|oluşturdum|sildim|kapattım'),
  // Passive past: it was opened, it was sent.
  edged('açıldı|gönderildi|kaydedildi|indirildi|kuruldu|oluşturuldu|tamamlandı'),
  edged('tamamdır|oldu bitti'),

  // ── English ──────────────────────────────────────────────────────────────
  edged("(it'?s|it is|now)\\s+playing"),
  edged("i'?(ve| have)\\s+(opened|sent|started|saved|downloaded|installed|created|deleted|closed|set)"),
  edged('i\\s+(opened|sent|started|saved|downloaded|installed|created|deleted|closed)\\s+(it|that|them)'),
  edged("(it'?s|it is|that'?s)\\s+(open|sent|done|saved|installed|ready)"),
  edged('has been (opened|sent|saved|installed|created)'),
];

/**
 * Claiming to remember something it has not been shown.
 *
 * The same lie in a different tense, and watched in the app too: "yes, I think
 * I remember something" followed immediately by asking the user what they had
 * said. Nothing was recalled — the memory was not read, and the sentence exists
 * only because agreeing is the likelier continuation than admitting a blank.
 *
 * Worse than the action claim in one way: the user answers it. They repeat
 * themselves believing they are jogging a memory that is there, and the
 * assistant builds on what they just said while still holding nothing.
 */
const RECALLED: readonly RegExp[] = [
  edged('hatırlıyorum|hatırladım|anımsıyorum'),
  edged('(evet|tabii|elbette)[,.]?\\s*(bir şeyler\\s*)?hatırl'),
  edged('daha önce (söylemiştin|bahsetmiştin|demiştin)'),
  edged('i remember( that| it| you)?'),
  edged('you (told|mentioned) me (that|it|this|before)'),
];

/**
 * Phrasings that are about to act rather than claiming to have acted.
 *
 * Checked first and win outright. "I'm opening it now" contains none of the
 * completed forms above, but "opening it now — it's playing" would, and the
 * first clause is what the user actually hears as the promise.
 */
const UNDER_WAY: readonly RegExp[] = [
  /\b(açıyorum|arıyorum|bakıyorum|yapıyorum|başlatıyorum|indiriyorum|hallediyorum|ilgileniyorum)\b/i,
  /\bbir (saniye|dakika)\b/i,
  /\b(hemen|şimdi) (bak|aç|yap|dene)[ıi]yorum\b/i,
  /\bi'?m (opening|searching|looking|starting|downloading|working|checking)\b/i,
  /\b(one|just a) (moment|second)\b/i,
  /\blet me (look|check|open|try)\b/i,
];

/** Questions are never claims — "shall I open it?" must survive untouched. */
const ASKING = /[?？]\s*$/;

/**
 * Whether this reply asserts that something has already been done.
 *
 * Deliberately conservative: anything ambiguous is treated as not a claim. The
 * cost of a miss is the failure this file is named after, which is bad; the
 * cost of a false positive is refusing a true sentence and calling the
 * assistant a liar in front of the user, which is worse and much harder to
 * explain.
 */
export const claimsCompletedAction = (reply: string): boolean => {
  const text = reply.trim();
  if (text.length === 0) return false;
  if (ASKING.test(text)) return false;
  if (UNDER_WAY.some((pattern) => pattern.test(text))) return false;
  return COMPLETED.some((pattern) => pattern.test(text));
};

/**
 * Whether this reply claims to recall something.
 *
 * Kept apart from the action claim because what backs it is different: an
 * action is backed by a tool call, a recollection is backed by there being
 * something in the memory to recall. A trailing question mark is not an escape
 * here — "yes, I remember something. What was it?" is the exact sentence this
 * is for, and it ends in a question.
 */
export const claimsRecall = (reply: string): boolean => {
  const text = reply.trim();
  if (text.length === 0) return false;
  return RECALLED.some((pattern) => pattern.test(text));
};

/**
 * Whether a claimed recollection is empty.
 *
 * `remembered` is what the memory and the carried transcript actually hold for
 * this conversation. Nothing held and a claim made is the failure; something
 * held is the assistant doing its job.
 */
export const isEmptyRecall = (reply: string, remembered: number): boolean => remembered === 0 && claimsRecall(reply);

export const emptyRecallCorrection = (reply: string): string =>
  [
    `You just said: "${reply.trim()}"`,
    'That claims you remember something, and there is nothing in your memory or in this conversation about it, so you do not.',
    'Do not ask them to remind you as though it were on the tip of your tongue. Say plainly that you have nothing recorded about it, and offer to remember it now.',
  ].join(' ');

/**
 * Whether a turn's reply should be refused.
 *
 * `toolsRan` is the whole of the other side: a claim backed by a tool that came
 * back is simply the assistant reporting its work, which is what it is supposed
 * to do. Only an unbacked claim is a lie.
 */
export const isUnbackedClaim = (reply: string, toolsRan: number): boolean =>
  toolsRan === 0 && claimsCompletedAction(reply);

/**
 * What to tell the model when it has been caught.
 *
 * Addressed to the model, not the user, and phrased as an instruction for this
 * turn rather than a scolding: it goes into the history as a system turn and
 * the next thing generated has to be either the tool call or an honest
 * admission. It names what was said, because a correction that does not quote
 * the sentence is one the model argues with.
 */
export const unbackedClaimCorrection = (reply: string): string =>
  [
    `You just said: "${reply.trim()}"`,
    'That claims something has been done, and you called no tool this turn, so it has not been done and what you said is not true.',
    'Do not repeat it and do not apologise. Call the tool that actually does it, now.',
    // "I cannot" is deliberately not offered as a way out. Almost nothing the
    // user asks for is genuinely impossible here — `app_ask_jester` drives the
    // real machine — so a model allowed to plead inability will take that exit
    // instead of the work, and the user is no better off than being lied to.
    'If no specific tool fits, hand the whole request to `app_ask_jester`, which can do anything on this computer.',
    'Only say you cannot do something after a tool has come back and told you it failed.',
  ].join(' ');
