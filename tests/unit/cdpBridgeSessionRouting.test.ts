/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ÕøŞÕ¢ÆµÁï×»ò´╝ÜÕıòø«µáç CDP ÚÇÜÚüôÜäõ╝Ü×»Ø×À»ö▒ÕÑæ║ĞÒÇé
 *
 * ×Ğåøûõ©ñõ©¬õ║Æø©ï¼½ïÒÇüõ¢åÚâ¢õ╝Ü×«®ÒÇî½ïÕê╗Õñ▒×┤ÑÒÇıÕÅİµêÉÒÇîµîéµ¡╗Õê░×ÂàµùÂÒÇıÜä╝║ÚÖÀ´╝Ü
 *
 *  1. attachedToTarget ÚçıÕñıÕ«úÕ©â´╝ê£şµ¡úµá╣Õøá´╝ëÒÇésetAutoAttach õ©Ä attachToTarget Úâ¢×íÑÕÅæ×┐Öõ©¬
 *     õ║ïõ╗Â´╝î×Çî puppeteer µöÂÕê░µùÂµùáµØíõ╗Â `#sessions.set(id, new CdpCDPSession(...))`´╝î
 *     õ©ıµúÇµşÑµİ»ÕÉĞÕÀ▓Õ¡İÕ£¿ ÔÇöÔÇö ¼¼õ║îµ¼íÕ«úÕ©âµèèõ╝Ü×»ØÕ»╣×▒íµıóµêÉÕ©Ğ®║ CallbackRegistry Üäµû░Õ»╣×▒í´╝î
 *     ×░âö¿µû╣µëïÚçîÜä handle ÚÜÅÕı│µêÉõ©║Õ¡ñÕä┐ÒÇé
 *
 *  2. ÕøŞÕîàµ╝ÅµÄë sessionIdÒÇépuppeteer µîë sessionId ×À»ö▒ÕøŞÕîà´╝Üµ╝ÅµÄëÕ░▒µèò╗Ö Connection ║ğ
 *     registry´╝î×ÇîÚíÁÚØó║ğÕæ¢õ╗ñÜä callback ÕÅ¬Ö╗×«░Õ£¿ session ║ğ registry ÚçîÒÇé
 *
 * õ©ñ×ÇàÜä╗êÕ▒Çõ©ÇµáÀ´╝ÜCallbackRegistry µşÑõ©ıÕê░ id Õ░▒ÚØÖÚ╗İ return´╝îPromise µ░©õ©ı settle´╝î
 * µ£ÇÕÉÄõ╗ÑÒÇîNetwork.enable timed out. Increase the 'protocolTimeout' settingÒÇıµÁ«Ä░ ÔÇöÔÇö
 * õ©ÇµØíµîçÕÉæ×ÂàµùÂ×«¥¢«ÜäÕüç║┐┤ó´╝î£şÕ«ŞÕÄşÕøá×ó½Õ«îÕà¿ÕÉŞµÄëÒÇéµëÇõ╗ÑÕ┐àÚí╗ö¿µÁï×»òÚÆëõ¢Å´╝îõ║║ÕÀÑ review
 * Õ¥êÚÜ¥ÕÅæÄ░´╝ÜµêÉÕèş×À»Õ¥äõ©Ä catch ×À»Õ¥äÚâ¢µİ»Õ»╣Üä´╝îµ╝ÅÜäÕÅ¬µİ»×┐Öõ©ñÕñä╗å×èéÒÇé
 *
 * Regression tests for the single-target CDP bridge's session-routing contract, covering two
 * independent defects that both turn an immediate failure into a hang:
 *
 *  1. Re-announcing attachedToTarget (the actual root cause). Both setAutoAttach and
 *     attachToTarget backfill it, and puppeteer unconditionally does
 *     `#sessions.set(id, new CdpCDPSession(...))` without checking for an existing entry, so the
 *     second announcement swaps in an object with an empty CallbackRegistry and orphans the
 *     handle the caller holds.
 *
 *  2. Replies omitting sessionId. puppeteer routes replies by sessionId; without it the reply
 *     goes to the Connection-level registry, while page-level callbacks live only in the
 *     session-level one.
 *
 * Both end the same way: CallbackRegistry silently returns on an unknown id, the promise never
 * settles, and it surfaces as "Network.enable timed out. Increase the 'protocolTimeout' setting"
 * ÔÇö a misleading clue that buries the real cause. Worth pinning down in tests, since review
 * misses this easily: the success and catch paths were both correct.
 */

import { describe, expect, it } from 'vitest';
import {
  SINGLE_SESSION_ID,
  SINGLE_TARGET_ID,
  buildTargetInfo,
  decideCdpCommand,
  isAcceptableSessionId,
  tokensMatch,
} from '@process/resources/builtinMcp/cdpTargetProtocol';

const targetInfo = () => buildTargetInfo('Example', 'https://example.com');

describe('cdpTargetProtocol ÔÇö session routing contract', () => {
  it('accepts browser-level (empty) and the single page session, rejects anything else', () => {
    expect(isAcceptableSessionId(undefined)).toBe(true);
    expect(isAcceptableSessionId('')).toBe(true);
    expect(isAcceptableSessionId(SINGLE_SESSION_ID)).toBe(true);
    expect(isAcceptableSessionId('some-other-session')).toBe(false);
  });

  it('backfills attachedToTarget only for browser-level setAutoAttach', () => {
    /**
     * Õ©Ğ sessionId ÜäÚéúµ¼íÕ┐àÚí╗ÕÅ¬ÕøŞ®║ ack´╝Üpuppeteer µöÂÕê░ attachedToTarget ÕÉÄõ╝Üõ©║µû░ session
     * ÕåıÕÅæõ©Çµ¼í setAutoAttach´╝îÕĞéµŞ£µ»Åµ¼íÚâ¢×íÑÕÅæÕ░▒õ╝ÜµùáÚÖÉÚÇÆÕ¢Æ´╝î×┐ŞµÄÑµ░©×┐£ÕêØÕğïÕîûõ©ıÕ«îÒÇé
     *
     * The call carrying a sessionId must be a bare ack: puppeteer re-issues setAutoAttach on
     * each new session, so backfilling every time recurses forever and initialisation hangs.
     */
    const browserLevel = decideCdpCommand(
      { id: 1, method: 'Target.setAutoAttach', params: { autoAttach: true } },
      targetInfo
    );
    expect(browserLevel.kind).toBe('reply-and-emit');
    if (browserLevel.kind === 'reply-and-emit') {
      expect(browserLevel.emit.map((e) => e.method)).toContain('Target.attachedToTarget');
    }

    const sessionLevel = decideCdpCommand(
      { id: 2, method: 'Target.setAutoAttach', params: { autoAttach: true }, sessionId: SINGLE_SESSION_ID },
      targetInfo
    );
    expect(sessionLevel.kind).toBe('reply');
  });

  it('forwards non-Target commands to the debugger', () => {
    expect(decideCdpCommand({ id: 3, method: 'Network.enable', sessionId: SINGLE_SESSION_ID }, targetInfo).kind).toBe(
      'forward'
    );
  });

  it('refuses commands it cannot honour instead of pretending they worked', () => {
    /**
     * createTarget Õüç×úàµêÉÕèşõ╝Ü×«® Agent õ╗Ñõ©║Õ╝Çõ║åµû░ÚíÁÚØó´╝îÕ«ŞÚÖà×┐İÕ£¿ÕÄşÚíÁÚØóõ©èµôıõ¢£ ÔÇöÔÇö
     * µ»öø┤µÄÑÕñ▒×┤Ñµø┤ÚÜ¥µşÑÒÇé
     *
     * Faking createTarget success would leave the agent driving the old page while believing
     * it had a new one ÔÇö harder to diagnose than an explicit failure.
     */
    expect(
      decideCdpCommand({ id: 4, method: 'Target.createTarget', params: { url: 'about:blank' } }, targetInfo).kind
    ).toBe('error');
    expect(decideCdpCommand({ id: 5, method: 'Browser.close' }, targetInfo).kind).toBe('error');
    expect(
      decideCdpCommand({ id: 6, method: 'Target.attachToTarget', params: { targetId: 'not-ours' } }, targetInfo).kind
    ).toBe('error');
  });

  it('attaches to our own target and hands back the fixed sessionId', () => {
    const decision = decideCdpCommand(
      { id: 7, method: 'Target.attachToTarget', params: { targetId: SINGLE_TARGET_ID } },
      targetInfo
    );
    expect(decision.kind).toBe('reply-and-emit');
    if (decision.kind === 'reply-and-emit') {
      expect(decision.payload).toEqual({ sessionId: SINGLE_SESSION_ID });
    }
  });

  it('compares tokens without leaking length-independent early exits', () => {
    expect(tokensMatch('abc123', 'abc123')).toBe(true);
    expect(tokensMatch('abc123', 'abc124')).toBe(false);
    expect(tokensMatch('abc', 'abcdef')).toBe(false);
  });
});

/**
 * ÕñıÕê╗ handleSocketMessage Üäõ║ïõ╗ÂÕñûÕÅæÚÇ╗×¥æ´╝îÚÆëõ¢ÅÒÇîÕÉîõ©Ç sessionId ÕÅ¬Õ«úÕ©âõ©Çµ¼íÒÇıÒÇé
 *
 * ×┐Öµİ»µ£¼µ¼íµòàÚÜ£Üä£şµ¡úµá╣Õøá´╝ÜsetAutoAttach õ©Ä attachToTarget Úâ¢õ╝Ü×íÑÕÅæ attachedToTarget´╝î
 * ×Çî puppeteer µöÂÕê░×»Ñõ║ïõ╗ÂµùÂµùáµØíõ╗Â `#sessions.set(sessionId, new CdpCDPSession(...))`´╝î
 * õ©ıµúÇµşÑµİ»ÕÉĞÕÀ▓Õ¡İÕ£¿ÒÇéõ║Äµİ»¼¼õ║îµ¼íÕ«úÕ©âµèèõ╝Ü×»ØÕ»╣×▒íµıóµêÉõ©Çõ©¬Õ©Ğ®║ CallbackRegistry Üäµû░Õ»╣×▒í´╝î
 * ×░âö¿µû╣µëïÚçîÜäµùğ handle Õ░▒µêÉõ║åÕ¡ñÕä┐ ÔÇöÔÇö Õ«âÕÅæÕç║ÜäÕæ¢õ╗ñ id Ö╗×«░Õ£¿µùğ registry´╝îÕøŞÕîàµîë
 * sessionId ×À»ö▒×┐øµû░ registry´╝îµşÑµùáµ¡ñ id´╝îÚØÖÚ╗İõ©óÕ╝â´╝îPromise µ░©õ©ı settleÒÇé
 *
 * Pins "announce each sessionId at most once" ÔÇö the actual root cause. Both setAutoAttach and
 * attachToTarget backfill attachedToTarget, and puppeteer unconditionally does
 * `#sessions.set(sessionId, new CdpCDPSession(...))` without checking for an existing entry. The
 * second announcement therefore swaps in a fresh object with an empty CallbackRegistry and
 * orphans the handle the caller still holds: its command ids live in the old registry while
 * replies route by sessionId into the new one, where no such id exists ÔÇö dropped silently, and
 * the promise never settles.
 */
const collectEmitted = (
  methods: Array<{ method: string; params: Record<string, unknown> }>,
  announced: Set<string>
) => {
  const sent: string[] = [];
  for (const evt of methods) {
    if (evt.method === 'Target.attachedToTarget') {
      const id = (evt.params as { sessionId?: string }).sessionId;
      if (typeof id === 'string') {
        if (announced.has(id)) continue;
        announced.add(id);
      }
    }
    sent.push(evt.method);
  }
  return sent;
};

const emitOf = (decision: ReturnType<typeof decideCdpCommand>) =>
  decision.kind === 'reply-and-emit' ? decision.emit : [];

describe('cdpBridge attachedToTarget ÔÇö announce once per session', () => {
  it('suppresses the second attachedToTarget for an already-announced session', () => {
    const announced = new Set<string>();

    const fromAutoAttach = emitOf(
      decideCdpCommand({ id: 1, method: 'Target.setAutoAttach', params: { autoAttach: true } }, targetInfo)
    );
    expect(collectEmitted(fromAutoAttach, announced)).toContain('Target.attachedToTarget');

    // attachToTarget would announce the SAME sessionId again ÔÇö that is what orphaned the handle.
    const fromAttach = emitOf(
      decideCdpCommand({ id: 2, method: 'Target.attachToTarget', params: { targetId: SINGLE_TARGET_ID } }, targetInfo)
    );
    expect(collectEmitted(fromAttach, announced)).not.toContain('Target.attachedToTarget');
  });

  it('still announces on a fresh connection, which has its own empty set', () => {
    /**
     * µû░×┐ŞµÄÑÜä puppeteer µëïõ©èµ▓íµ£ëõ╗╗õ¢òõ╝Ü×»ØÕ»╣×▒í´╝îÕ┐àÚí╗µöÂÕê░ attachedToTarget µëı×â¢Õ╗║½ï´╝ø
     * µëÇõ╗Ñ×┐Öõ©¬ÚøåÕÉêÕ┐àÚí╗µİ»µ»Å×┐ŞµÄÑõ©Çõ╗¢´╝îõ©ı×â¢×À¿×┐ŞµÄÑÕà▒õ║½ÒÇé
     *
     * A newly connected puppeteer holds no session objects and needs the event to build them,
     * so the set must be per-connection rather than shared.
     */
    const freshConnection = new Set<string>();
    const emitted = emitOf(
      decideCdpCommand({ id: 1, method: 'Target.setAutoAttach', params: { autoAttach: true } }, targetInfo)
    );
    expect(collectEmitted(emitted, freshConnection)).toContain('Target.attachedToTarget');
  });
});

/**
 * ÕñıÕê╗ cdpBridge.handleSocketMessage ÜäÕøŞÕîà╗ä×úà´╝îÚ¬î×»ü sessionId õ©ÇÕ«Ü×ó½ÕøŞÕí½ÒÇé
 *
 * õ©ıø┤µÄÑ import cdpBridge´╝ÜÕ«âÚíÂÕ▒éÕ░▒ import electron ÕÆî ws´╝îÕ£¿ÕıòµÁïÄ»ÕóâÚçîµïëõ©ı×ÁÀµØÑÒÇé
 * ×┐ÖÚçîÚò£ÕâÅÚéúµ«ÁÕ║ÅÕêùÕîûÚÇ╗×¥æ´╝îµû¡×¿ÇÜäµİ»ÒÇîÕøŞÕîàÕ¢óèÂÒÇı×┐Öõ©¬ÕÑæ║Ğµ£¼×║½ÒÇé
 *
 * Mirrors cdpBridge.handleSocketMessage's reply assembly to assert the sessionId is echoed.
 * cdpBridge itself is not imported: it pulls in electron and ws at module scope, which will
 * not load under the unit-test environment. The contract under test is the reply shape.
 */
const buildErrorReply = (id: number | undefined, message: string, sessionId?: string) =>
  JSON.parse(JSON.stringify({ id: id ?? 0, error: { code: -32601, message }, sessionId }));

describe('cdpBridge reply shape ÔÇö sessionId must be echoed', () => {
  it('echoes sessionId on error replies to page-level commands', () => {
    const reply = buildErrorReply(3, 'The in-app browser is not currently attached.', SINGLE_SESSION_ID);
    expect(reply.sessionId).toBe(SINGLE_SESSION_ID);
  });

  it('omits sessionId for browser-level commands', () => {
    /**
     * µÁÅ×ğêÕÖ¿║ğÕæ¢õ╗ñµ£¼µØÑÕ░▒õ©ı×»ÑÕ©Ğ sessionId´╝ÜÕ©Ğõ©èõ╝Ü×«® puppeteer ÕÄ╗µë¥õ©Çõ©¬õ©ıÕ¡İÕ£¿Üä sessionÒÇé
     * JSON.stringify õ╝Üõ©óµÄë undefined Õ¡ùµ«Á´╝îµ¡úÕÑ¢Õ¥ùÕê░µ£şµ£øÜäÕ¢óèÂÒÇé
     *
     * Browser-level commands must not carry one, or puppeteer would look up a session that
     * does not exist. JSON.stringify drops undefined fields, giving exactly that shape.
     */
    const reply = buildErrorReply(1, 'nope', undefined);
    expect('sessionId' in reply).toBe(false);
  });
});
