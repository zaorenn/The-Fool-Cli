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
 * Word boundaries that understand the alphabets this app speaks.
 *
 * `\b` is defined against `[A-Za-z0-9_]`, so it does not fire beside `ş`, `ı`,
 * `ü` or any other letter outside ASCII — `/\bşimdi/` matches nothing at all,
 * silently, including at the start of a string. That is not a Turkish problem;
 * it is every locale here except English. Unicode lookarounds instead.
 */
const edged = (body: string): RegExp => new RegExp(`(?<!\\p{L})(?:${body})(?!\\p{L})`, 'iu');

/**
 * Turkish with its diacritics folded away.
 *
 * Transcription drops them constantly — Whisper writes "Simdi caliyor" as often
 * as "Şimdi çalıyor" — and a small local model asked to answer in Turkish does
 * the same. Matching only the properly accented spellings left the guard off
 * for a large share of real turns. A test against the pipeline caught that; a
 * test of the patterns alone, written in tidy Turkish, never would have.
 *
 * Both the text and the patterns are folded, so neither side carries two
 * spellings of every word.
 */
const FOLD: Record<string, string> = {
  ş: 's',
  Ş: 's',
  ç: 'c',
  Ç: 'c',
  ı: 'i',
  İ: 'i',
  ğ: 'g',
  Ğ: 'g',
  ö: 'o',
  Ö: 'o',
  ü: 'u',
  Ü: 'u',
};

const fold = (text: string): string => text.replace(/[şŞçÇıİğĞöÖüÜ]/g, (character) => FOLD[character] ?? character);

/**
 * Claims that the thing is already true.
 *
 * Written as explicit alternations rather than a loose stem match, because the
 * near-misses are all real speech: `açacağım` is a promise, `açayım mı` is a
 * question, and `açtım` is the claim. A pattern relaxed enough to catch every
 * conjugation catches the first two as well, and refusing a question the
 * assistant was right to ask is a worse failure than the one being prevented.
 *
 * Written folded, because that is what they are matched against.
 */
const COMPLETED: readonly RegExp[] = [
  // ── Turkish ──────────────────────────────────────────────────────────────
  // Playing, in the sense of "it is playing now".
  edged('(simdi|su ?an(da)?|artik)\\s+caliyor'),
  edged('calmaya basladi'),
  edged('oynatmaya basladim'),
  // First person past: opened, sent, did, saved, downloaded, installed, set up.
  edged('actim|gonderdim|yaptim|hallettim|kaydettim|indirdim|kurdum|baslattim|ayarladim|olusturdum|sildim|kapattim'),
  edged('buldum|ekledim|yazdim|caldim|oynattim|gosterdim|kopyaladim|tasidim|degistirdim|guncelledim'),
  // Buying and booking, which is the costliest thing it can claim and was the
  // one missing: reported from a real conversation where "bileti aldım" was
  // spoken with no tool behind it. `aldim` alone is left out on purpose — it is
  // also how somebody says "got it, understood", and refusing that would call
  // the assistant a liar for agreeing.
  edged('satin aldim|(bilet|rezervasyon|siparis)\\w*\\s+(aldim|yaptim|verdim)'),
  // Passive past: it was opened, it was sent.
  edged('acildi|gonderildi|kaydedildi|indirildi|kuruldu|olusturuldu|tamamlandi'),
  edged('tamamdir|oldu bitti'),

  // ── English ──────────────────────────────────────────────────────────────
  edged("(it'?s|it is|now)\\s+playing"),
  edged("i'?(ve| have)\\s+(opened|sent|started|saved|downloaded|installed|created|deleted|closed|set)"),
  edged('i\\s+(opened|sent|started|saved|downloaded|installed|created|deleted|closed)\\s+(it|that|them)'),
  edged("(it'?s|it is|that'?s)\\s+(open|sent|done|saved|installed|ready)"),
  edged('has been (opened|sent|saved|installed|created)'),
  edged("i'?(ve| have)\\s+(bought|booked|ordered|purchased|found|added|written|played)"),
  edged('i\\s+(bought|booked|ordered|purchased|found|added|played)\\s+(it|that|them|you)'),
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
  edged('hatirliyorum|hatirladim|animsiyorum'),
  edged('(evet|tabii|elbette)[,.]?\\s*(bir seyler\\s*)?hatirl\\w*'),
  edged('daha once (soylemistin|bahsetmistin|demistin)'),
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
  edged('aciyorum|ariyorum|bakiyorum|yapiyorum|baslatiyorum|indiriyorum|hallediyorum|ilgileniyorum'),
  edged('bir (saniye|dakika)'),
  edged('(hemen|simdi) (bak|ac|yap|dene)iyorum'),
  edged("i'?m (opening|searching|looking|starting|downloading|working|checking)"),
  edged('(one|just a) (moment|second)'),
  edged('let me (look|check|open|try)'),
];

/** Questions are never claims — "shall I open it?" must survive untouched. */
const ASKING = /[?？]\s*$/;

/**
 * The grammar, instead of the vocabulary.
 *
 * The list above grew a verb at a time, and every addition arrived the same
 * way: somebody was lied to, the word was noted, the word was added. That does
 * not converge. There are as many verbs as there are things a person might ask
 * for, and the list is always one conversation behind.
 *
 * Turkish marks this in the word itself. First person singular past is
 * `-dım/-dim/-dum/-düm` and its voiceless pair `-tım/-tim/-tum/-tüm`, which fold
 * to four endings — and *every* claim of a finished action wears one. So the
 * rule is the suffix, and what is enumerated instead is the small, closed set
 * that does not grow: the verbs that describe the speaker's own mind rather than
 * the world.
 *
 * Two forms are excluded by their shape rather than by a list. A negated past
 * (`yapmadım`, "I did not do it") is the opposite of a claim, and a past
 * continuous (`yapıyordum`, "I was doing it") is not finished.
 */
const FIRST_PERSON_PAST = /(dim|dum|tim|tum)$/;
const NEGATED_PAST = /(ma|me)(dim|dum)$/;
const WAS_DOING = /yordu/;

/**
 * Past tenses that report a state of mind, not a change to the world.
 *
 * This is the list that is allowed to exist, because it is finite: a person has
 * a fixed handful of ways to say they understood, heard, saw or thought, and no
 * new feature will add one. Everything outside it is treated as a claim about
 * the world and has to be backed by a tool.
 *
 * `aldim` is here for a reason worth keeping: it is also how somebody says
 * "got it". The costly reading — a ticket, an order, a purchase — is caught by
 * its own pattern above, where the object makes the meaning unambiguous.
 */
const ABOUT_THE_SPEAKER: ReadonlySet<string> = new Set([
  'anladim',
  'aldim',
  'duydum',
  'gordum',
  'dusundum',
  'sandim',
  'zannettim',
  'istedim',
  'unuttum',
  'hissettim',
  'begendim',
  'sevdim',
  'bildim',
  'tanidim',
  'ogrendim',
  'dedim',
  'soyledim',
  'sordum',
  'baktim',
]);

/** English regular past, with the same exemption for verbs about the speaker. */
const ENGLISH_PAST = /(?<!\p{L})i\s+(?:just\s+)?(\p{L}+ed)(?!\p{L})/iu;
const ENGLISH_ABOUT_THE_SPEAKER: ReadonlySet<string> = new Set([
  'wanted',
  'wondered',
  'remembered',
  'noticed',
  'realized',
  'realised',
  'assumed',
  'guessed',
  'liked',
  'needed',
  'tried',
  'looked',
  'asked',
  'hoped',
  'expected',
  'understood',
]);

/** Whether any word in the reply is a first-person past claim about the world. */
const claimsByGrammar = (folded: string): boolean => {
  // Folded first, then lowered, in that order. `fold` already sends `İ` and `ı`
  // to `i`, so what is left for `toLowerCase` is ordinary ASCII and it cannot
  // reach for the Turkish dotless-i rule that would otherwise split a word from
  // its own capitalised form.
  const turkish = folded.split(/[^\p{L}]+/u).some((raw) => {
    const word = raw.toLowerCase();
    if (word.length < 5 || !FIRST_PERSON_PAST.test(word)) return false;
    if (NEGATED_PAST.test(word) || WAS_DOING.test(word)) return false;
    return !ABOUT_THE_SPEAKER.has(word);
  });
  if (turkish) return true;

  const english = ENGLISH_PAST.exec(folded);
  return english !== null && !ENGLISH_ABOUT_THE_SPEAKER.has(english[1].toLowerCase());
};

/**
 * Whether this reply asserts that something has already been done.
 *
 * Read together with its caller: this is consulted only for a turn in which no
 * tool came back, so the question is never "is this sentence true" but "could
 * this sentence possibly be true, given that nothing ran". That is what lets
 * the grammatical rule be as broad as it is — the cost of catching one sentence
 * too many is a single extra round in a turn that had nothing to show for
 * itself anyway.
 */
export const claimsCompletedAction = (reply: string): boolean => {
  const text = reply.trim();
  if (text.length === 0) return false;
  if (ASKING.test(text)) return false;

  const folded = fold(text);
  if (UNDER_WAY.some((pattern) => pattern.test(folded))) return false;
  if (COMPLETED.some((pattern) => pattern.test(folded))) return true;
  return claimsByGrammar(folded);
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
  return RECALLED.some((pattern) => pattern.test(fold(text)));
};

/**
 * Whether a claimed recollection is empty.
 *
 * `remembered` is what the memory and the carried transcript actually hold for
 * this conversation. Nothing held and a claim made is the failure; something
 * held is the assistant doing its job.
 */
/**
 * Asking to be reminded of the thing it has just claimed to remember.
 *
 * "Yes, I remember — what was it again?" This is hollow whatever the memory
 * holds, which is why it is checked separately from {@link isEmptyRecall}:
 * counting the memory's length answers "is anything remembered", and the
 * question here is "is *this* remembered". A memory full of other things made
 * the length check pass and let the sentence straight through, which is how it
 * was still being said in 2.3.7.
 *
 * Someone who remembers does not need reminding. The two together are proof
 * enough on their own.
 */
const ASKS_TO_BE_REMINDED: readonly RegExp[] = [
  edged('tekrar (soyler|soylermisin|hatirlatir|anlatir)\\w*'),
  edged('(ne|neydi|nasil)(ydi)? (oldugunu|soylemistin|demistin)'),
  edged('bana (tekrar|yeniden) (soyle|hatirlat)\\w*'),
  edged('remind me'),
  edged('what was it( again)?'),
  edged('tell me again'),
];

export const asksToBeReminded = (reply: string): boolean => {
  const folded = fold(reply.trim());
  return ASKS_TO_BE_REMINDED.some((pattern) => pattern.test(folded));
};

/**
 * Whether a claimed recollection is empty.
 *
 * Two ways it can be. Nothing remembered at all is the obvious one. The other
 * is claiming to remember and asking to be reminded in the same breath, which
 * is hollow however much the memory holds — and is the form this actually takes
 * in practice, because the memory is rarely completely empty.
 */
export const isEmptyRecall = (reply: string, remembered: number): boolean => {
  if (!claimsRecall(reply)) return false;
  return remembered === 0 || asksToBeReminded(reply);
};

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
 * Describing a screen nobody looked at.
 *
 * The third lie, and the one still being told. The persona has carried the rule
 * since the beginning — "you cannot see the screen; never describe one you have
 * not looked at" — and a persona rule cut it to roughly one turn in six rather
 * than to none, which is what a rule can do and no more. `claimsCompletedAction`
 * catches "I did it"; nothing caught "there is a connection error on your
 * screen", which is worse in the way that matters: an invented action can be
 * checked by looking, and an invented screen is *confirmed* by looking, because
 * the user looks at their own screen and finds something, and something is
 * usually close enough to whatever was guessed.
 *
 * The shape of the check follows `screenIntent.ts`, which asks the same question
 * about the other side of the conversation, and for the same reason: a screen
 * noun on its own is not a claim ("shall I look at your screen?") and an
 * assertion on its own is not about a screen. It is the two together.
 */

/** Nouns that exist only because somebody is looking at a display. */
const SCREEN_SUBJECTS: readonly RegExp[] = [
  // ── Turkish ──────────────────────────────────────────────────────────────
  edged('ekran\\w*'),
  edged('pencere\\w*'),
  edged('sekme\\w*'),
  edged('(hata|uyari|bildirim|mesaj)\\w*'),
  edged('(terminal|konsol|tarayici)\\w*'),
  edged('(sayfa|sayfada|sayfanin|sayfada?ki)'),
  edged('(buton|dugme|menu|pencerede)\\w*'),
  // ── English ──────────────────────────────────────────────────────────────
  edged('screens?'),
  edged('windows?'),
  edged('tabs?'),
  edged('(error|warning|dialog|notification|message)s?'),
  edged('(terminal|console|browser)s?'),
  edged('pages?'),
  edged('(button|menu)s?'),
];

/**
 * Asserting that something is visible, or that it says a particular thing.
 *
 * Present tense and first-person sight, because that is the grammar of a
 * description: "it says", "there is", "I can see", "yazıyor", "görünüyor". A
 * past-tense report of a screen it once looked at is a different sentence and is
 * governed by whether the look ever happened, which is the caller's half.
 */
const ASSERTS_VISIBLE: readonly RegExp[] = [
  // ── Turkish ──────────────────────────────────────────────────────────────
  edged('(yaziyor|yazan|yazmis)'),
  edged('(goruyorum|goruyor|gorunuyor|gorunmekte|gozukuyor)'),
  edged('(diyor|demis|belirtiyor|soyluyor)'),
  edged('(gosteriyor|gosterilen|gosterilmekte)'),
  edged('(acik|aciktir|acilmis)'),
  edged('var(dir)?'),
  edged('(yok|yoktur)'),
  edged('(bir|su|bu) (hata|uyari|mesaj)\\w*'),
  // ── English ──────────────────────────────────────────────────────────────
  edged('(i|you) can see'),
  edged('i (see|can make out)'),
  // Bare, rather than after a pointing word: "the page says …" is the sentence,
  // and requiring "it says" caught only half of the ways it is written.
  edged('(says|say|said)'),
  edged('(shows|showing|displays|displaying|reads)'),
  edged('there (is|are|seems? to be)'),
  edged("(it'?s|it is|that'?s) (open|showing|displaying)"),
  edged('(looks like|appears to be|seems to be)'),
];

/**
 * Saying plainly that it cannot see, which is the sentence this wants more of.
 *
 * Checked before anything else and wins outright. "I cannot see your screen" is
 * built from a screen noun and an assertion and is the exact opposite of a
 * claim; refusing it would train the assistant out of the only honest answer it
 * has.
 */
const CANNOT_SEE: readonly RegExp[] = [
  edged('(goremiyorum|goremem|goremedim|gormuyorum|gormedim)'),
  edged('(bakmadim|bakamadim|bakamiyorum|bakamam)'),
  edged('(ekrani|ekranini|ekraninizi)\\s+\\w*(goremiyorum|goremem|gormuyorum)'),
  edged('(bilmiyorum|emin degilim)'),
  edged("(i )?(can'?t|cannot|could not|couldn'?t) see"),
  edged("(i )?(haven'?t|have not|did not|didn'?t) (looked|seen)"),
  edged("(i )?don'?t know what"),
  edged("(i am|i'?m) not able to see"),
  edged('no access to (your |the )?screen'),
];

/**
 * About to look, rather than reporting what was seen.
 *
 * The same exemption `UNDER_WAY` gives an action, for the same reason: "let me
 * look at your screen" is the behaviour the prompt is asking for, and a gate
 * that refused it would leave the assistant with nothing it is allowed to say
 * between the question and the screenshot.
 */
const ABOUT_TO_LOOK: readonly RegExp[] = [
  edged('(bakiyorum|bakayim|bakacagim|bakalim|inceliyorum)'),
  edged('(goruntusunu|ekran goruntusu) (aliyorum|alayim|alacagim)'),
  edged("i'?m (looking|taking a look|checking)"),
  edged('let me (look|see|check|take a look)'),
  edged("i'?ll (look|check|take a look)"),
];

/**
 * Whether this reply describes what is on a screen.
 *
 * Read together with its caller, exactly like {@link claimsCompletedAction}:
 * this is consulted only when no screen has been looked at, so the question is
 * never "is this description accurate" — it is "could this sentence be about
 * anything real, given that nothing has been seen". Nothing has, so it cannot.
 */
export const claimsAboutScreen = (reply: string): boolean => {
  const text = reply.trim();
  if (text.length === 0) return false;
  // A question is a question in every one of these gates. "Is there an error on
  // your screen?" is the assistant doing the right thing.
  if (ASKING.test(text)) return false;

  const folded = fold(text);
  if (CANNOT_SEE.some((pattern) => pattern.test(folded))) return false;
  if (ABOUT_TO_LOOK.some((pattern) => pattern.test(folded))) return false;

  return (
    SCREEN_SUBJECTS.some((pattern) => pattern.test(folded)) && ASSERTS_VISIBLE.some((pattern) => pattern.test(folded))
  );
};

/**
 * Whether this sentence describes a screen that was never looked at.
 *
 * `lookedAtScreen` is conversation-wide rather than per turn, and that is a
 * deliberate weakening. Scoped to the turn, "what did the error say again?" one
 * turn after a genuine look would be refused — a correct answer, drawn from a
 * screenshot that really is in the history, thrown away. A stale description is
 * a smaller wrong than an assistant that cannot refer back to what it saw ten
 * seconds ago.
 */
export const isUnseenScreenClaim = (reply: string, lookedAtScreen: boolean): boolean =>
  !lookedAtScreen && claimsAboutScreen(reply);

/**
 * What to tell the model when it has described a screen it never saw.
 *
 * Names the tool, because "you did not look" without "here is how to look" is a
 * correction the model answers by apologising and then describing the screen
 * again in softer words.
 */
/**
 * The only tools through which this assistant ever sees a screen.
 *
 * A set rather than a comparison, because the answer to "has it looked" must not
 * be spread across three files that each remember a different spelling — and
 * because a second way of looking is a thing somebody will add, and this is
 * where they will find the list.
 */
export const SCREEN_TOOLS: ReadonlySet<string> = new Set(['app_look_at_screen']);

/**
 * Whether a screen tool's result actually contains a screen.
 *
 * The distinction the eval found and nothing in the product could see. Asked to
 * look with the capture permission missing, the tool ran, failed, and came back
 * — and *a tool ran* is the whole of what the older gate checks, so the model
 * was free to describe the screen with a call behind it and nothing in the call.
 * Pressed a second time, it did.
 *
 * So the evidence is the result, never the invocation. `ok: false`, an `error`,
 * or nothing where the screen should be all mean the same thing: it has not seen
 * anything, and it is not allowed to say what is there.
 */
export const showedTheScreen = (name: string, result: unknown): boolean => {
  if (!SCREEN_TOOLS.has(name)) return false;
  if (result === null || result === undefined) return false;
  if (typeof result === 'string') return result.trim().length > 0;
  if (typeof result !== 'object') return false;

  const record = result as { ok?: unknown; error?: unknown; screen?: unknown };
  if (record.ok === false) return false;
  if (typeof record.error === 'string' && record.error.trim().length > 0) return false;
  // A description that came back empty is a capture that technically succeeded
  // and saw nothing, which is the same as not having looked.
  if (typeof record.screen === 'string') return record.screen.trim().length > 0;
  return true;
};

export const unseenScreenCorrection = (reply: string): string =>
  [
    `You just said: "${reply.trim()}"`,
    'That describes what is on the screen, and you have not looked at it this conversation, so you are describing something you have never seen.',
    'Do not soften it into "it seems to be" or "it might say" — a guess about a screen is the same mistake said less clearly.',
    'Call `app_look_at_screen` now and answer only from what comes back.',
  ].join(' ');

/**
 * Saying a thing is playing when all that happened was a page being opened.
 *
 * The fourth lie, and the one the first three were all shaped to miss. Watched
 * in the app, asked for a favourite song: it searched, drove the mouse at the
 * results, took two screenshots, and finished with "your favourite song should
 * now be playing in the browser — the video is loaded and ready to play. If you
 * need me to click the play button, just let me know." Three sentences that
 * cannot all be true, and a user who now believes their music is on.
 *
 * Every gate this file already had passed it.
 *
 * - {@link claimsCompletedAction} never fired: "should now be playing" is not
 *   one of the completed forms, and it is not a first-person past either. The
 *   hedge is what carries it — "should be", "must be", "is ready to" — and a
 *   hedge is the shape a model reaches for precisely when it does not know.
 * - {@link isUnbackedClaim} would not have refused it anyway. Four tools ran
 *   that turn. *A tool ran* is the whole of what that gate asks, and none of the
 *   four was capable of making the sentence true.
 *
 * So this asks the only question that settles it: did anything actually report
 * that sound is coming out. Handing an address to a browser does not; it is a
 * page opening, and the honest sentence about it is that it was opened. Only a
 * player that answered "playing, this track, on that device" is evidence, which
 * is what {@link startedPlayback} reads.
 */

/**
 * Asserting that something is, or is about to be, audible.
 *
 * The hedged forms are first-class rather than an afterthought. "It should be
 * playing" is the same claim as "it is playing" said less honestly, and it is
 * the form actually observed — a model that has opened a page and cannot see it
 * writes the sentence it hopes is true.
 */
const ASSERTS_PLAYING: readonly RegExp[] = [
  // ── Turkish ──────────────────────────────────────────────────────────────
  // Playing, and the hedge that is the same claim: "çalıyor olmalı".
  edged('caliyor(\\s+olmali)?'),
  edged('calmaya (basladi|baslamis|hazir)'),
  edged('(oynatiliyor|oynuyor|caliniyor|calinmaya basladi)'),
  edged('(sarki|muzik|video|parca)\\w*\\s+(basladi|basliyor|calmaya basladi)'),
  // ── English ──────────────────────────────────────────────────────────────
  edged("(is|are|'?s|'?re)\\s+(now\\s+)?playing"),
  edged('(should|must|ought to|will)\\s+(now\\s+)?be\\s+(playing|starting)'),
  edged('now playing'),
  edged('(started|begun|begins) playing'),
  edged('playing (now|in (your|the) (browser|player|background))'),
  // The second sentence of the observed reply. "Loaded", "ready to play" are
  // assertions about a page nobody looked at, offered in place of the playing
  // that could not be confirmed.
  edged('(loaded|ready)( and ready)? to (play|go)'),
  edged('(song|track|video|music) (is|has) (on|started|begun)'),
];

/**
 * Saying plainly that it is not playing, or cannot play it.
 *
 * The sentence this gate wants more of, and it is built from the same words as
 * the lie. Checked first and wins outright, exactly like {@link CANNOT_SEE}.
 */
const NOT_PLAYING: readonly RegExp[] = [
  edged('(calmiyor|calamiyorum|calamam|calamadim|baslatamadim|acamadim)'),
  edged('(caldigini|caldigindan) emin degilim'),
  edged("(i )?(can'?t|cannot|could not|couldn'?t|was not able to) (play|start)"),
  edged("(is|'?s|are) not playing"),
  edged("(i )?(don'?t|do not) know (whether|if) it (is|started)"),
];

/**
 * About to start it, rather than reporting that it started.
 *
 * The same exemption the other three gates give, for the same reason: "I'm
 * putting it on now" is the announce-then-call behaviour the prompt asks for,
 * and refusing it would leave nothing sayable between the request and the tool.
 */
const ABOUT_TO_PLAY: readonly RegExp[] = [
  edged('(caliyorum|aciyorum|baslatiyorum|koyuyorum|ariyorum)'),
  edged('(calmaya|acmaya|baslatmaya) (calisiyorum|gidiyorum)'),
  edged("i'?m (playing|putting|starting|opening|queuing|queueing)"),
  edged('let me (play|put|start)'),
  edged("i'?ll (play|put|start)"),
];

/**
 * Whether this reply asserts that something is audible.
 *
 * Read together with its caller in the same way as every other gate here: it is
 * consulted only when nothing has reported that playback began, so the question
 * is never "is this true" but "could it be, given that no player said so".
 */
export const claimsPlayback = (reply: string): boolean => {
  const text = reply.trim();
  if (text.length === 0) return false;
  if (ASKING.test(text)) return false;

  const folded = fold(text);
  if (NOT_PLAYING.some((pattern) => pattern.test(folded))) return false;
  if (ABOUT_TO_PLAY.some((pattern) => pattern.test(folded))) return false;

  return ASSERTS_PLAYING.some((pattern) => pattern.test(folded));
};

/**
 * The only tools through which this assistant can know something is playing.
 *
 * A set for the same reason `SCREEN_TOOLS` is one: the answer to "did anything
 * start playing" must not be spread over three files that each remember a
 * different spelling, and whoever adds a second player will find the list here.
 *
 * `app_open_url`, `app_search` and `app_skill_do` are deliberately *not* in it.
 * All three end with an address in a browser, which is a page opening and
 * nothing more — the exact substitution this gate exists to refuse.
 */
export const PLAYBACK_TOOLS: ReadonlySet<string> = new Set(['app_play']);

/**
 * Whether a tool result actually reports that sound is coming out.
 *
 * The evidence is the result, never the invocation — the lesson
 * {@link showedTheScreen} was rewritten to learn. `app_play` answers `playing:
 * true` only when a player accepted the track and named the device it is coming
 * from; asked for the same song with nothing connected it answers `playing:
 * false` beside the address it opened instead, and that is not evidence of
 * anything being audible.
 */
export const startedPlayback = (name: string, result: unknown): boolean => {
  if (!PLAYBACK_TOOLS.has(name)) return false;
  if (result === null || typeof result !== 'object') return false;

  const record = result as { ok?: unknown; playing?: unknown };
  if (record.ok === false) return false;
  return record.playing === true;
};

/** Whether this sentence claims a playback nothing has confirmed. */
export const isUnverifiedPlaybackClaim = (reply: string, playbackStarted: boolean): boolean =>
  !playbackStarted && claimsPlayback(reply);

/**
 * What to tell the model when it has said a page opening was a song starting.
 *
 * Names the honest sentence rather than only the mistake, because "you did not
 * verify that" on its own is answered with the same claim in a softer hedge —
 * which is how "it is playing" became "it should be playing" in the first place.
 */
export const unverifiedPlaybackCorrection = (reply: string): string =>
  [
    `You just said: "${reply.trim()}"`,
    'That says something is playing, and nothing has reported that it is. Opening a page in a browser is not playing: the page may still be loading, it may be an advert, and nothing has pressed play.',
    'Do not hedge it into "should be playing" or "is ready to play" — a guess about sound is the same mistake said less clearly.',
    'Say only what actually happened — that you opened it — or call `app_play`, which plays it in the background and answers with the track and the device when it really is playing.',
  ].join(' ');

/**
 * Whether a tool result is evidence that something was *finished*.
 *
 * Not every tool that comes back has done anything yet. A task handed to the
 * agent returns the moment it is accepted — the flight is not booked, the
 * folder is not tidied, and the work will run for minutes after the turn has
 * ended. Counting that as evidence would open the exact hole the gate exists to
 * close, one level further along: instead of claiming to have done something
 * with no tool behind it, the model would claim it with a tool behind it that
 * had only agreed to start.
 *
 * Anything that does not say so counts, because the great majority of tools
 * really have finished by the time they answer, and a gate that demanded proof
 * of completion from all of them would refuse honest reports.
 */
export const backsCompletedAction = (result: unknown): boolean => {
  if (result === null || typeof result !== 'object') return true;
  return (result as { accepted?: unknown }).accepted !== true;
};

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

/**
 * Saying an application is open when nothing started one.
 *
 * The third gate of this shape, and the clearest argument for why the count of
 * tools cannot be the evidence. Reported from a live session: asked to open
 * Forza Horizon 6, `app_open_app` ran and came back a failure — the game is not
 * installed and the Windows launcher could not have started it if it were — and
 * the assistant then read the game's title off the screen and said it was open.
 *
 * Every count-based check passed, because a tool really had run. The one thing
 * that could have made the sentence true reported the opposite, and nothing was
 * asking it. An invented launch is worse than an invented song for the same
 * reason an invented screen is: the user goes and looks, finds the title
 * somewhere, and is confirmed in believing it.
 */
const ASSERTS_APP_OPEN: readonly RegExp[] = [
  // ── Turkish, folded ──────────────────────────────────────────────────────
  edged('(acik|acildi|actim|acti)'),
  edged('(calisiyor|calismakta|calisir durumda)'),
  edged('(baslatildi|baslattim|baslatmis oldum)'),
  edged('(su anda|simdi) (acik|calisiyor)'),
  // ── English ──────────────────────────────────────────────────────────────
  edged("(is|are|'?s|'?re)\\s+(now\\s+)?(open|running|up and running)"),
  edged('i (opened|launched|started) it'),
  edged('(opened|launched|started) (it|the (app|game|application|program))'),
  edged('(the )?(app|game|application|program) (is|has) (open|running|started|launched)'),
];

/**
 * Saying plainly that it did not open, which is the sentence this wants more of.
 *
 * Checked first and wins outright, exactly like {@link NOT_PLAYING}. "Açamadım"
 * is the honest answer to the Forza turn and must never be scored as a claim.
 */
const NOT_OPENED: readonly RegExp[] = [
  edged('(acamadim|acilamadi|baslatamadim|bulunamadi|bulamadim|yuklu degil|kurulu degil)'),
  edged("(i )?(can'?t|cannot|could not|couldn'?t|was not able to) (open|start|launch|find)"),
  edged("(is|'?s|are) not (open|running|installed)"),
  edged("(don'?t|do not|didn'?t|did not) (see|find|have) (it|that|the (app|game))"),
];

/**
 * About to open it, rather than reporting that it opened.
 *
 * The same exemption the other three gates give. Checked before the assertions
 * so that "açmaya çalışıyorum" is not read as the "çalışıyor" that means
 * something is running.
 */
const ABOUT_TO_OPEN: readonly RegExp[] = [
  edged('(aciyorum|baslatiyorum|calistiriyorum)'),
  edged('(acmaya|baslatmaya) (calisiyorum|gidiyorum)'),
  edged("i'?m (opening|starting|launching)"),
  edged('let me (open|start|launch)'),
  edged("i'?ll (open|start|launch)"),
];

/**
 * Whether this reply asserts that an application is running.
 *
 * Consulted only when nothing has reported a launch, so the question it answers
 * is never "is this true" but "could it be, given that no launcher said so".
 */
export const claimsAppOpen = (reply: string): boolean => {
  const text = reply.trim();
  if (text.length === 0) return false;
  if (ASKING.test(text)) return false;

  const folded = fold(text);
  if (NOT_OPENED.some((pattern) => pattern.test(folded))) return false;
  if (ABOUT_TO_OPEN.some((pattern) => pattern.test(folded))) return false;

  return ASSERTS_APP_OPEN.some((pattern) => pattern.test(folded));
};

/**
 * The only tools through which this assistant can know an application started.
 *
 * `app_ask_jester` is deliberately not in it. The agent may well have opened
 * something, but it reports in prose rather than in a field, and a gate that
 * accepted prose as evidence would be accepting the model's own account of its
 * work — which is the thing being checked.
 */
export const APP_LAUNCH_TOOLS: ReadonlySet<string> = new Set(['app_open_app']);

/** What a turn's launch attempt came to, if it made one at all. */
export type AppLaunchOutcome = 'none' | 'opened' | 'failed';

/**
 * What `app_open_app` actually did, read from its result rather than its call.
 *
 * Three states rather than a boolean, because the gate below turns on the
 * difference between "no launch was attempted" and "one was attempted and
 * failed". Only the second contradicts a sentence saying something is open;
 * the first is an ordinary turn in which the assistant may well have learned
 * from somewhere else that an application is running.
 *
 * Closing something answers `opened: false`, so quitting Discord is never
 * evidence that a game is up.
 */
export const appLaunchOutcome = (name: string, result: unknown): AppLaunchOutcome => {
  if (!APP_LAUNCH_TOOLS.has(name)) return 'none';
  if (result === null || typeof result !== 'object') return 'none';

  const record = result as { ok?: unknown; opened?: unknown };
  if (record.ok === false) return 'failed';
  return record.opened === true ? 'opened' : 'none';
};

/**
 * Whether this sentence says an application is open that has just failed to open.
 *
 * Narrow on purpose, and narrower than it first was. Written to fire whenever
 * nothing had confirmed a launch, it refused "I opened it in your browser" and
 * "Kod editörü açık" — a page that really did open, and an observation made by
 * looking. Both are honest reports, and a judge whose failures are the correct
 * behaviour is worse than no judge, because it is read as evidence.
 *
 * So the question it asks is not "was this confirmed" but "was this
 * contradicted": a launch was attempted in this turn, it came back a failure,
 * and the assistant is nonetheless saying the thing is running. That is the
 * reported turn exactly — `app_open_app` failed on a game that is not even
 * installed, and the title was then read off the screen and announced as a
 * running game.
 */
export const isContradictedAppOpenClaim = (reply: string, launchFailed: boolean): boolean =>
  launchFailed && claimsAppOpen(reply);

export const contradictedAppOpenCorrection = (reply: string): string =>
  [
    `You just said: "${reply.trim()}"`,
    'That says an application is open, and nothing has reported that one started. Seeing its name on the screen is not evidence it is running — a title in a store page, a shortcut, or this conversation all put that text there.',
    'Do not soften it into "it should be open now" — a guess about the machine is the same mistake said less clearly.',
    'Say what actually happened, including plainly that you could not open it, or call `app_open_app`, which answers with the launch when the system really accepted it.',
  ].join(' ');
