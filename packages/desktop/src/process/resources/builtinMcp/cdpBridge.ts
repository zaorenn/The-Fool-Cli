/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Õıòø«µáç CDP ÚÇÜÚüô´╝ÜÕÅ¬µèèÒÇîõ¥ğ×¥╣µÁÅ×ğêÕÖ¿Úéúõ©Çõ©¬ webContentsÒÇıµÜ┤Ú£▓╗Ö AgentÒÇé
 *
 * µø┐õ╗ú Chromium Üä remote-debugging-portÒÇéÚéúõ©¬Õ╝ÇÕà│µİ»Õ║öö¿║ğÜä´╝îµ▓íµ£ë per-target ACL´╝î
 * õ©ÇÕ╝ÇÕ░▒µèèõ©╗¬ùÕÅú´╝ê×┐ŞØÇ preload µíÑ´╝ëµÜ┤Ú£▓╗Öµ£¼µ£║õ╗╗µäÅ×┐ø¿ïÒÇé×┐ÖÚçîµö╣µêÉ´╝Ü
 *   - ÕÅ¬╗æ 127.0.0.1´╝îõ©öÕ┐àÚí╗Õ©ĞÕÅúõ╗ñµëı×â¢×┐Ş
 *   - ÕÅ¬µ£ıÕèíõ©Çõ©¬ø«µáç´╝îTarget.* ö▒ cdpTargetProtocol µ£¼Õ£░Õ║ö¡ö
 *   - ÕàÂõ¢ÖÕæ¢õ╗ñÚÇÅõ╝á╗Ö webContents.debugger
 *
 * Single-target CDP bridge: exposes only the in-app browser's webContents to the agent.
 * Replaces Chromium's remote-debugging-port, which is application-wide with no
 * per-target ACL and therefore also exposes the main window and its preload bridge.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { webContents, type Debugger, type WebContents } from 'electron';
import {
  SINGLE_SESSION_ID,
  buildListPayload,
  buildTargetInfo,
  buildVersionPayload,
  decideCdpCommand,
  isAcceptableSessionId,
  tokensMatch,
  type CdpRequest,
} from './cdpTargetProtocol';

const HOST = '127.0.0.1';
const WS_PATH = '/aionui-cdp';

export type CdpBridgeHandle = {
  port: number;
  token: string;
  /** õ¥ğ×¥╣µÁÅ×ğêÕÖ¿Üä webContents id´╝øµ£¬ÚÖäÕèáµùÂõ©║ nullÒÇé/ null while nothing is attached. */
  attachedWebContentsId: () => number | null;
  attach: (webContentsId: number) => { ok: true } | { ok: false; reason: string };
  detach: () => void;
  close: () => Promise<void>;
};

type AttachedState = {
  contents: WebContents;
  dbg: Debugger;
  onMessage: (event: unknown, method: string, params: unknown, sessionId: string) => void;
  onDestroyed: () => void;
};

let attached: AttachedState | null = null;
let sockets = new Set<WebSocket>();

const currentTargetInfo = () => {
  if (!attached || attached.contents.isDestroyed()) return buildTargetInfo('', 'about:blank');
  return buildTargetInfo(attached.contents.getTitle(), attached.contents.getURL());
};

const broadcast = (payload: Record<string, unknown>) => {
  const text = JSON.stringify(payload);
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) ws.send(text);
  }
};

const detachInternal = () => {
  if (!attached) return;
  const { contents, dbg, onMessage, onDestroyed } = attached;
  attached = null;
  try {
    dbg.removeListener('message', onMessage);
    contents.removeListener('destroyed', onDestroyed);
    if (dbg.isAttached()) dbg.detach();
  } catch {
    // ÕÀ▓╗ÅÚöÇµ»ü/ÕÀ▓ÕêåĞ╗µùÂ Electron õ╝Üµèø´╝îÕ┐¢òÑÕı│ÕÅ»ÒÇé
    // Electron throws if it is already destroyed or detached; nothing to do.
  }
};

/**
 * ÚÖäÕèáÕê░µîçÕ«Ü webContentsÒÇé
 *
 * õ©ñÚüôµáíÚ¬îÚâ¢Õ┐àÚí╗µèÑÚöÖ×Çîõ©ıµİ»ÒÇîÕ░¢Õèø×Çîõ©║ÒÇı´╝Ü
 *  - getType() Õ┐àÚí╗µİ» webview´╝ÜÚİ▓µ¡óµèèõ©╗¬ùÕÅú´╝êÕ©Ğ preload µíÑ´╝ëõ║ñÕç║ÕÄ╗´╝î×┐Öµ¡úµİ»ÕÄşµû╣µíêÜäµ╝Åµ┤ŞÒÇé
 *  - debugger.attach() õ╝ÜÕÆîÕÉîõ©Çõ©¬ webContents õ©èµëôÕ╝ÇÜä DevTools Õå▓¬ü´╝êElectron ÚÖÉÕêÂ´╝ë´╝î
 *    ×┐ÖµùÂ╗ÖÕç║ÕÅ»×»╗ÜäÕÄşÕøá´╝î×Çîõ©ıµİ»µèøõ©Çõ©¬ÕÄşÕğïÕ╝éÕ©©ÒÇé
 *
 * Both checks must fail loudly rather than degrade:
 *  - getType() must be 'webview', so the main window (with its preload bridge) can never
 *    be handed over ÔÇö that is precisely the hole in the process-wide approach.
 *  - debugger.attach() conflicts with DevTools open on the same webContents (an Electron
 *    limitation); surface a readable reason instead of a raw throw.
 */
const attachInternal = (webContentsId: number): { ok: true } | { ok: false; reason: string } => {
  const contents = webContents.fromId(webContentsId);
  if (!contents || contents.isDestroyed()) {
    return { ok: false, reason: `No live webContents with id ${webContentsId}` };
  }

  const type = contents.getType();
  if (type !== 'webview') {
    return {
      ok: false,
      reason: `Refusing to attach to webContents of type "${type}"; only the in-app browser webview may be exposed.`,
    };
  }

  if (attached?.contents.id === webContentsId) return { ok: true };
  detachInternal();

  const dbg = contents.debugger;
  try {
    if (!dbg.isAttached()) dbg.attach('1.3');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `Could not attach debugger (DevTools open on this view will block it): ${message}` };
  }

  const onMessage = (_event: unknown, method: string, params: unknown, _sessionId: string) => {
    /**
     * ╗şõ©Ç×┤┤õ©èµêæõ╗¼Úéúõ©¬Õø║Õ«Ü sessionId Õåı×¢¼ÕÅæÒÇé
     *
     * puppeteer ö¿ flatten µ¿íÕ╝Å´╝îÕ«âÚØá sessionId µèèõ║ïõ╗Â×À»ö▒Õê░Õ»╣Õ║öÜäÚíÁÚØóõ╝Ü×»Ø´╝øõ©ı×┤┤Üä×»Ø
     * õ║ïõ╗Âõ╝Ü×ó½Õ¢ôµêÉµÁÅ×ğêÕÖ¿║ğÜä´╝îPage/Runtime Úéúõ║øõ║ïõ╗ÂÕ░▒õ©óõ║åÒÇé
     *
     * Stamp our fixed sessionId before forwarding. puppeteer runs in flatten mode and
     * routes events to the page session by sessionId; without it these would look
     * browser-level and Page/Runtime events would be dropped.
     */
    broadcast({ method, params: params ?? {}, sessionId: SINGLE_SESSION_ID });
  };

  const onDestroyed = () => {
    detachInternal();
    broadcast({ method: 'Target.targetDestroyed', params: { targetId: currentTargetInfo().targetId } });
  };

  dbg.on('message', onMessage);
  contents.once('destroyed', onDestroyed);
  attached = { contents, dbg, onMessage, onDestroyed };
  return { ok: true };
};

/**
 * ÕøŞÕîàÕ┐àÚí╗Õ©Ğõ©èÕàÑ½ÖÜä sessionId´╝îÕÉĞÕêÖÚíÁÚØó║ğÕæ¢õ╗ñõ╝Üµ░©õ╣àµîé×ÁÀÒÇé
 *
 * puppeteer µîë sessionId ÕêåÕÅæÕøŞÕîà´╝êcdp/Connection.js´╝ë´╝ÜÕ©Ğ sessionId Üäõ║ñ╗ÖÕ»╣Õ║ö
 * CdpSession Üä CallbackRegistry´╝îõ©ıÕ©ĞÜäõ║ñ╗Ö Connection ×ç¬ÕÀ▒Úéúõ©Çõ╗¢ÒÇé×ÇîÚíÁÚØó║ğÕæ¢õ╗ñµİ»
 * ö¿ session.send() ÕÅæÜä´╝îcallback ÕÅ¬Ö╗×«░Õ£¿ session Üä registry Úçî ÔÇöÔÇö ÕøŞÕîàõ©ÇµùĞµ╝ÅµÄë
 * sessionId Õ░▒õ╝Ü×ó½µèòÕê░ Connection Üä registry´╝îÚéúÚçîµşÑµùáµ¡ñ id´╝î
 * CallbackRegistry.resolve/reject ø┤µÄÑÚØÖÚ╗İ return´╝îPromise µ░©õ©ı settleÒÇé
 *
 * õ║Äµİ»õ©Çõ©¬µ£¼×»ÑÒÇî½ïÕê╗µèÑÚöÖÒÇıÜäÕæ¢õ╗ñÕÅİµêÉõ║åµîéµ¡╗´╝îµ£ÇÕÉÄö▒ puppeteer Üä protocolTimeout µèøÕç║
 * ÒÇîXXX timed out. Increase the 'protocolTimeout' settingÒÇıÔÇöÔÇö õ©ÇµØíµèèõ║║µîçÕÉæ×ÂàµùÂ×«¥¢«Üä
 * Õüç║┐┤ó´╝î×Çî£şÕ«ŞÕÄşÕøá´╝êµ»öÕĞéµÁÅ×ğêÕÖ¿ÚØóµØ┐µ▓íµëôÕ╝Ç´╝ë×ó½Õ¢╗Õ║òÕÉŞµÄëÒÇé
 *
 * Replies must echo the inbound sessionId or page-level commands hang forever.
 * puppeteer routes replies by sessionId: with one it goes to that CdpSession's
 * CallbackRegistry, without one to the Connection's own. Page-level commands are sent via
 * session.send(), so the callback lives only in the session registry; a reply missing the
 * sessionId lands in the Connection registry, which has no such id, and
 * CallbackRegistry.resolve/reject silently returns ÔÇö the promise never settles.
 *
 * An immediate error therefore turns into a hang that surfaces as puppeteer's
 * "... timed out. Increase the 'protocolTimeout' setting", a misleading clue that buries the
 * real cause (e.g. the browser panel was never opened).
 */
const sendError = (ws: WebSocket, id: number | undefined, message: string, sessionId?: string) => {
  ws.send(JSON.stringify({ id: id ?? 0, error: { code: -32601, message }, sessionId }));
};

/**
 * announcedSessions µİ»**µ»ÅµØí×┐ŞµÄÑ**ÜäèÂµÇü´╝îõ©ı×â¢µÅÉÕê░µ¿íÕØùõ¢£ö¿Õşş´╝Üõ©ÇµØíµû░×┐ŞµÄÑÜä puppeteer
 * µëïõ©èµ▓íµ£ëõ╗╗õ¢òõ╝Ü×»ØÕ»╣×▒í´╝îÕ┐àÚí╗Úçıµû░µöÂÕê░ attachedToTarget µëı×â¢Õ╗║½ï´╝ø×ïÑ×À¿×┐ŞµÄÑÕà▒õ║½´╝î¼¼õ║îõ©¬
 * Õ«óµêÀ½»Õ░▒µ░©×┐£¡ëõ©ıÕê░Úéúõ©¬õ║ïõ╗Â´╝îbrowser.pages() õ╝Üõ©Çø┤µİ» 0ÒÇé
 *
 * announcedSessions is PER-CONNECTION state and must not be hoisted to module scope: a freshly
 * connected puppeteer holds no session objects and needs attachedToTarget to build them. Sharing
 * the set across connections would starve the second client of that event, leaving
 * browser.pages() at 0 forever.
 */
const handleSocketMessage = async (ws: WebSocket, raw: string, announcedSessions: Set<string>) => {
  let req: CdpRequest;
  try {
    req = JSON.parse(raw) as CdpRequest;
  } catch {
    return; // ÚØŞ JSON ø┤µÄÑÕ┐¢òÑ / ignore non-JSON frames
  }

  const { id, method, params, sessionId } = req;
  if (!method) return;

  if (!isAcceptableSessionId(sessionId)) {
    sendError(ws, id, `Unknown sessionId: ${sessionId}`, sessionId);
    return;
  }

  const decision = decideCdpCommand(req, currentTargetInfo);

  if (decision.kind === 'error') {
    sendError(ws, id, decision.message, sessionId);
    return;
  }

  if (decision.kind === 'reply' || decision.kind === 'reply-and-emit') {
    ws.send(JSON.stringify({ id, result: decision.payload, sessionId }));
    if (decision.kind === 'reply-and-emit') {
      for (const evt of decision.emit) {
        /**
         * ÕÉîõ©Çõ©¬ sessionId ÕÅ¬Õ«úÕ©âõ©Çµ¼í attachedToTarget ÔÇöÔÇö ÚçıÕñıÕ«úÕ©âõ╝Ü×«® puppeteer µıóµÄë
         * õ╝Ü×»ØÕ»╣×▒í´╝îµèè×░âö¿µû╣µëïÚçîÜä handle ÕÅİµêÉÕ¡ñÕä┐ÒÇé
         *
         * puppeteer Üä Connection.onMessage µöÂÕê░ attachedToTarget µùÂµùáµØíõ╗Â
         * `new CdpCDPSession(...)` Õåı `#sessions.set(sessionId, session)`´╝êcdp/Connection.js´╝ëÒÇé
         * Õ«âõ©ıµúÇµşÑ×┐Öõ©¬ sessionId µİ»ÕÉĞÕÀ▓╗ÅÕ¡İÕ£¿´╝îõ║Äµİ»¼¼õ║îµ¼íÕ«úÕ©âõ╝Üö¿õ©Çõ©¬Õà¿µû░Õ»╣×▒í×ĞåøûµùğÜä´╝î
         * ×Çîµû░Õ»╣×▒íÕ©ĞØÇõ©Çõ╗¢®║Üä CallbackRegistryÒÇé
         *
         * ×┐Öµ¡úµİ»×ç┤Õæ¢õ╣ïÕñä´╝ÜsetAutoAttach ÕÀ▓╗ÅÕ«úÕ©â×┐çõ©Çµ¼í´╝îattachToTarget ÕåıÕ«úÕ©âõ©Çµ¼í´╝î
         * ×░âö¿µû╣´╝êTargetManager / õ╗╗õ¢òµîüµ£ë CDPSession Üäõ╗úáü´╝ëµëïõ©èÚéúõ©¬ handle Õ░▒µîçÕÉæõ║å×ó½
         * µıóµÄëÜäµùğÕ»╣×▒íÒÇéÕ«â send() Õç║ÕÄ╗ÜäÕæ¢õ╗ñ id Ö╗×«░Õ£¿µùğ registry Úçî´╝îÕøŞÕîàÕı┤µîë sessionId
         * ×ó½×À»ö▒Õê░µû░Õ»╣×▒íÜä registry ÔÇöÔÇö ÚéúÚçîµşÑµùáµ¡ñ id´╝îresolve/reject ÚØÖÚ╗İ return´╝î
         * Promise µ░©õ©ı settle´╝îµ£ÇÕÉÄõ╗Ñ protocolTimeout ÜäÕ¢óÕ╝ÅµÁ«Ä░ÒÇé
         *
         * £şÕ«Ş Chrome õ©ıõ╝ÜÚçıÕñıÕ«úÕ©âÕÀ▓ÚÖäÕèáÜäõ╝Ü×»Ø´╝îµëÇõ╗Ñ×┐Öµİ»µ£¼õ╝¬×úàÕ▒éë╣µ£ëÜäÚù«ÚóİÒÇé
         *
         * Announce attachedToTarget at most once per sessionId: re-announcing makes puppeteer
         * swap out the session object and orphans handles the caller already holds.
         *
         * On attachedToTarget, puppeteer's Connection.onMessage unconditionally constructs a
         * new CdpCDPSession and does `#sessions.set(sessionId, session)` ÔÇö it never checks
         * whether that sessionId already exists, so a second announcement replaces the old
         * object with a fresh one carrying an EMPTY CallbackRegistry.
         *
         * That is the fatal part: setAutoAttach already announced once, so announcing again on
         * attachToTarget leaves the caller holding the replaced object. Commands it sends
         * register their id in the old registry, while replies are routed by sessionId into the
         * new object's registry, which has no such id ÔÇö resolve/reject silently returns and the
         * promise never settles, surfacing later as a protocolTimeout.
         *
         * Real Chrome does not re-announce an already-attached session, so this is specific to
         * this emulation layer.
         */
        if (evt.method === 'Target.attachedToTarget') {
          const announcedId = (evt.params as { sessionId?: string }).sessionId;
          if (typeof announcedId === 'string') {
            if (announcedSessions.has(announcedId)) continue;
            announcedSessions.add(announcedId);
          }
        }
        ws.send(JSON.stringify({ method: evt.method, params: evt.params }));
      }
    }
    return;
  }

  // forward
  if (!attached || attached.contents.isDestroyed()) {
    /**
     * ×»┤µ©àµÑÜÒÇîµÇÄõ╣êÕèŞÒÇı´╝îÕøáõ©║ Agent õ¥ğµùáµ│ò×ç¬ÕÀ▒õ┐«Õñı´╝Üattach ÕÅ¬ö▒µ©▓µşô×┐ø¿ïÕ£¿ webview
     * dom-ready µùÂõ©èµèÑ×ğĞÕÅæ´╝êWebviewHost.tsx´╝ë´╝îTarget.createTarget ÕÅêµİ»µİÄí«µïÆ╗ØÜäÒÇé
     * µëÇõ╗Ñ×┐ÖµØíµÂêµü»Õ┐àÚí╗Õæè×»ëö¿µêÀÕÄ╗Õ╝ÇµÁÅ×ğêÕÖ¿ÚØóµØ┐´╝îÕÉĞÕêÖ Agent ÕÅ¬×â¢ÕÅıÕñıµÆŞÕÉîõ©ÇÚØóÕóÖÒÇé
     *
     * Say what to do about it: the agent cannot fix this itself. Attachment is only
     * triggered by the renderer reporting its webContents id on dom-ready
     * (WebviewHost.tsx), and Target.createTarget is explicitly refused ÔÇö so this message
     * has to point at opening the browser panel, or the agent just retries into the same wall.
     */
    sendError(
      ws,
      id,
      'The in-app browser is not currently attached. Open the browser panel in AionUi so a page is available to control.',
      sessionId
    );
    return;
  }

  try {
    const result = await attached.dbg.sendCommand(method, params ?? {});
    ws.send(JSON.stringify({ id, result: result ?? {}, sessionId }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ws.send(JSON.stringify({ id, error: { code: -32000, message }, sessionId }));
  }
};

const writeJson = (res: ServerResponse, body: unknown) => {
  const text = JSON.stringify(body);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
};

/**
 * ÕÉ»Õè¿ÚÇÜÚüôÒÇé×┐öÕøŞ handle õ¥øõ©╗×┐ø¿ïÕ£¿µÁÅ×ğêÕÖ¿ tab ÕêçµıóµùÂµö╣ÚÖäÕèáø«µáçÒÇé
 *
 * ÕÅúõ╗ñÕÅ¬ÕèáÕ£¿ WebSocket µ«Á´╝îõ©ıÕèáÕ£¿ HTTP ÕÅæÄ░µ«Á ÔÇöÔÇö ×┐Öµİ»×ó½Õ«ŞµÁïÚÇ╝Õç║µØÑÜä×«¥×«í´╝Ü
 * puppeteer µï┐ browserURL ÕÉÄµëğ×íî `new URL('/json/version', browserURL)`´╝î╗ØÕ»╣×À»Õ¥äõ╝Ü
 * µèè query µò┤µ«Áõ©óµÄë´╝îµëÇõ╗ÑÕÅúõ╗ñµö¥Õ£¿ browserURL Üä ?token= õ©èµá╣µ£¼õ╝áõ©ıÕê░µ£ıÕèí½»´╝î
 * ÕÅ¬õ╝Ü×«® puppeteer ×ó½×ç¬ÕÀ▒Üä 403 µîíµ¡╗ÒÇé
 *
 * õ║Äµİ»Õêåõ©ñÕ▒é´╝Ü
 *  - HTTP ÕÅæÄ░µ«Á´╝ê/json/versionÒÇü/json/list´╝ëõ©ıµáíÚ¬îÕÅúõ╗ñ´╝îÕôıÕ║öÚçîÕ©ĞØÇÕÉ½ÕÅúõ╗ñÜä ws Õ£░ÕØÇÒÇé
 *  - WebSocket µ«ÁÕ╝║ÕêÂµáíÚ¬îÕÅúõ╗ñ´╝îµëÇµ£ëÕ«ŞÚÖàµÄğÕêÂÚâ¢×Á░×┐ÖÚçîÒÇé
 *
 * ÔÜá´©Å Õ¿ü×âüµ¿íÕŞï×Ğü×»┤Õ«Ş×»Ø´╝ÜÕøáõ©║ÕÅæÄ░µ«Áõ©ıÚë┤µØâõ©öõ╝ÜÕÉÉÕç║ÕÅúõ╗ñ´╝îÕÉîµ£║ÕÉîö¿µêÀÜäõ╗╗µäÅ×┐ø¿ïµë½Õê░×┐Öõ©¬½»ÕÅúÕÉÄ
 * õ©Çõ©¬ GET Õ░▒×â¢ÕÅûÕøŞÕÅúõ╗ñÕåı×┐Ş WSÒÇéµëÇõ╗ÑÕÅúõ╗ñÜäõ¢£ö¿µİ»**Úİ╗µ¡óø▓×┐Ş**´╝êõ©ışÑÚüô½»ÕÅú/µ▓í×»╗×┐çÕÅæÄ░µ«Á
 * Üä×┐ŞµÄÑõ©ÇÕ¥ï 403´╝ë´╝î**õ©ıµİ»×║½õ╗¢×»üµİÄ** ÔÇöÔÇö Õ«âµùáµ│ò×»üµİÄÕ»╣½»Õ░▒µİ»µêæõ╗¼ spawn ÜäÚéúõ©¬ MCPÒÇé
 * Õ»╣µ£¼µ£║×┐ø¿ï×Çî×¿Ç´╝î£şÕ«ŞÕ▒ÅÚÜ£ÕÅ¬µ£ëÒÇîlisten(0) ÚÜÅµ£║ÕêåÚàıÜäõ©┤µùÂ½»ÕÅúÒÇı×┐Öõ©ÇÕ▒éÒÇé
 *
 * ×┐Öõ©Ä Chrome ÕÄşöş remote-debugging-port Üä /json/version µİ»ÕÉîõ©Çµ░┤Õ╣│´╝îõ©ıµİ»ÕøŞÕ¢Æ´╝øµ£¼µû╣µíê£şµ¡ú
 * ÜäµöÂøèÕ£¿Õê½Õñä´╝ÜÕÅ¬µÜ┤Ú£▓õ¥ğ×¥╣µÁÅ×ğêÕÖ¿Úéúõ©Çõ©¬ webview´╝î╗Øõ©ıµÜ┤Ú£▓õ©╗¬ùÕÅú´╝ê×ğü attachInternal Üä
 * getType() µáíÚ¬î´╝ëÒÇéµèèÒÇîÕÉîö¿µêÀµ£¼µ£║×┐ø¿ïÒÇı«ùõ¢£ÕÅ»õ┐í×¥╣òîµİ»×┐ÖÚçîÜäµİ¥Õ╝ÅÕüç×«¥ÒÇé
 *
 * The token guards only the WebSocket leg, not HTTP discovery ÔÇö a design forced by testing:
 * puppeteer runs `new URL('/json/version', browserURL)`, and an absolute path discards the
 * entire query string, so a token on browserURL never reaches the server and would only make
 * puppeteer trip over its own 403.
 *
 * Hence two tiers:
 *  - HTTP discovery (/json/version, /json/list) is unauthenticated and its response carries
 *    a tokened ws address.
 *  - The WebSocket enforces the token; all actual control flows there.
 *
 * ÔÜá´©Å Be honest about the threat model: because discovery is unauthenticated and hands the
 * token out, any process running as the same user can scan this port and retrieve the token
 * with one GET, then connect. The token therefore **prevents blind connections** (anything
 * that has not read discovery gets a 403); it is **not proof of identity** and cannot show
 * the peer is the MCP we spawned. Against local processes the only real barrier is the
 * ephemeral, OS-assigned listen(0) port.
 *
 * This matches Chrome's own remote-debugging-port /json/version and is not a regression. The
 * real gain of this design lies elsewhere: only the in-app browser webview is exposed and the
 * main window never is (see the getType() check in attachInternal). Treating same-user local
 * processes as inside the trust boundary is an explicit assumption here.
 */
export const startCdpBridge = async (): Promise<CdpBridgeHandle> => {
  const token = randomBytes(24).toString('hex');

  const httpServer: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${HOST}`);
    const wsUrl = `ws://${HOST}:${port}${WS_PATH}?token=${token}`;
    const info = currentTargetInfo();

    if (url.pathname === '/json/version') {
      writeJson(res, buildVersionPayload(wsUrl, process.versions.chrome ?? '0.0.0.0'));
      return;
    }
    if (url.pathname === '/json/list' || url.pathname === '/json') {
      writeJson(res, buildListPayload(wsUrl, info.title, info.url));
      return;
    }
    res.writeHead(404).end('not found');
  });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${HOST}`);
    if (url.pathname !== WS_PATH || !tokensMatch(token, url.searchParams.get('token') ?? '')) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.add(ws);
      const announcedSessions = new Set<string>();
      ws.on('message', (data) => void handleSocketMessage(ws, data.toString(), announcedSessions));
      ws.on('close', () => sockets.delete(ws));
      ws.on('error', () => sockets.delete(ws));
    });
  });

  const port = await new Promise<number>((resolve, reject) => {
    httpServer.once('error', reject);
    // ½»ÕÅú 0 = ×«®│╗╗şÕêåÚàı®║Úù▓½»ÕÅú´╝îÚü┐ÕàıÕÆîÕê½Üäµ£ıÕèíµÆŞÒÇé
    // Port 0 lets the OS pick a free port so we cannot collide with another service.
    httpServer.listen(0, HOST, () => {
      const addr = httpServer.address();
      if (addr && typeof addr === 'object') resolve(addr.port);
      else reject(new Error('Could not determine bridge port'));
    });
  });

  return {
    port,
    token,
    attachedWebContentsId: () => (attached && !attached.contents.isDestroyed() ? attached.contents.id : null),
    attach: attachInternal,
    detach: detachInternal,
    close: async () => {
      detachInternal();
      for (const ws of sockets) ws.close();
      sockets = new Set();
      await new Promise<void>((resolve) => {
        wss.close(() => httpServer.close(() => resolve()));
      });
    },
  };
};
