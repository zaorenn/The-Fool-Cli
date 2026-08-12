/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Õıòø«µáç CDP ×¢¼ÕÅæÕ▒éÜä║»ÕıÅ×««ÚÇ╗×¥æ´╝êõ©ıÕÉ½ Electron / socket õ¥Ø×Áû´╝îõ¥┐õ║ÄÕıòµÁï´╝ëÒÇé
 *
 * õ©║õ╗Çõ╣êÚ£Ç×Ğü×┐Öõ©ÇÕ▒é´╝ÜChromium Üä remote-debugging-port µİ»ÒÇîµò┤õ©¬Õ║öö¿║ğÒÇıÜä´╝îµ▓íµ£ë
 * per-target ACL´╝îÕ╝Çõ©Çõ©¬ÕÅúÕ¡É¡ëõ║Äµèèõ©╗¬ùÕÅú´╝ê×┐ŞØÇ preload µíÑ´╝ëõ©Ç×ÁÀµÜ┤Ú£▓╗Öµ£¼µ£║õ╗╗µäÅ×┐ø¿ïÒÇé
 * µêæõ╗¼µö╣µêÉÕÅ¬Õ»╣õ¥ğ×¥╣µÁÅ×ğêÕÖ¿Úéúõ©Çõ©¬ webContents µÜ┤Ú£▓´╝îõ¢å chrome-devtools-mcp ö¿Üäµİ»
 * puppeteer Üä browserURL ×┐ŞµÄÑµû╣Õ╝Å´╝îÕ«âõ©èµØÑÕ░▒µèèÕ»╣ÚØóÕ¢ôµêÉÒÇîõ©Çµò┤õ©¬µÁÅ×ğêÕÖ¿ÒÇı´╝îÕàêÕÅæ
 * Target.setDiscoverTargets / setAutoAttach´╝îÕåıÚØá Target.attachToTarget µï┐ sessionIdÒÇé
 * Electron Üä webContents.debugger ÕÅ¬×â¢µ£ıÕèíÕıòõ©¬ÚíÁÚØó´╝î¡öõ©ıõ©è×┐Öõ║øÕæ¢õ╗ñÒÇé
 *
 * µëÇõ╗Ñ×┐ÖÚçîµèè×ç¬ÕÀ▒õ╝¬×úàµêÉÒÇîÕÅ¬µ£ëõ©Çõ©¬µáç¡¥ÚíÁÜäµÁÅ×ğêÕÖ¿ÒÇı´╝ÜTarget.* ö▒µêæõ╗¼µ£¼Õ£░Õ║ö¡ö´╝îÕàÂõ¢ÖÕæ¢õ╗ñ
 * ÚÇÅõ╝á╗Ö debuggerÒÇéElectron Üä debugger µöÂÕÅæõ©ñ½»Úâ¢µö»µîü sessionId´╝êelectron.d.ts
 * sendCommand(method, params, sessionId) õ©Ä 'message' õ║ïõ╗ÂÜä sessionId ÕÅéµò░´╝ë´╝î
 * µëÇõ╗Ñ puppeteer ×ĞüÜä flatten µ¿íÕ╝Å×â¢Õ»╣õ©èÒÇé
 *
 * Pure protocol logic for the single-target CDP bridge (no Electron or socket
 * dependency, so it can be unit-tested).
 *
 * Why this layer exists: Chromium's remote-debugging-port is application-wide with no
 * per-target ACL, so opening it exposes the main window ÔÇö and its preload bridge ÔÇö to
 * any local process. We narrow it to just the browser webview, but chrome-devtools-mcp
 * connects via puppeteer's browserURL, which treats the endpoint as a whole browser: it
 * sends Target.setDiscoverTargets / setAutoAttach up front and obtains a sessionId via
 * Target.attachToTarget. Electron's webContents.debugger serves a single page and cannot
 * answer those.
 *
 * So we present ourselves as a browser that happens to have exactly one tab: Target.*
 * is answered locally, everything else is forwarded to the debugger. Electron's debugger
 * supports sessionId in both directions, so puppeteer's flatten mode lines up.
 */

/** õ╝¬ÚÇáÜä¿│Õ«Ü id´╝ÜÕÅ¬µ£ëõ©Çõ©¬ø«µáç´╝îõ©ıÚ£Ç×Ğü£şÜäÕêåÚàıÒÇé/ Fixed ids ÔÇö there is only ever one target. */
export const SINGLE_TARGET_ID = 'aionui-browser-target';
export const SINGLE_SESSION_ID = 'aionui-browser-session';
export const SINGLE_BROWSER_CONTEXT_ID = 'aionui-browser-context';

export type TargetInfo = {
  targetId: string;
  type: 'page';
  title: string;
  url: string;
  attached: boolean;
  canAccessOpener: boolean;
  browserContextId: string;
};

export type CdpRequest = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  sessionId?: string;
};

/** µ£¼Õ£░Õ║ö¡ö / ÚÇÅõ╝á╗Ö debugger / µİÄí«µïÆ╗ØÒÇé */
export type CdpDecision =
  | { kind: 'reply'; payload: Record<string, unknown> }
  | {
      kind: 'reply-and-emit';
      payload: Record<string, unknown>;
      emit: Array<{ method: string; params: Record<string, unknown> }>;
    }
  | { kind: 'forward' }
  | { kind: 'error'; message: string };

export const buildTargetInfo = (title: string, url: string): TargetInfo => ({
  targetId: SINGLE_TARGET_ID,
  type: 'page',
  title,
  url,
  attached: true,
  canAccessOpener: false,
  browserContextId: SINGLE_BROWSER_CONTEXT_ID,
});

/**
 * /json/version ÜäÕôıÕ║öÒÇépuppeteer Üä getWSEndpoint() ÕÅ¬×»╗ webSocketDebuggerUrl´╝î
 * õ¢å Browser.version() õ╝Üö¿Õê░ Browser Õ¡ùµ«Á´╝îõ©ÇÕ╣Â╗ÖÕà¿Úü┐ÕàıÕÉÄ╗¡µèÑÚöÖÒÇé
 *
 * puppeteer's getWSEndpoint() only reads webSocketDebuggerUrl, but Browser.version()
 * surfaces the Browser field, so provide both.
 */
export const buildVersionPayload = (wsUrl: string, chromeVersion: string) => ({
  Browser: `Chrome/${chromeVersion}`,
  'Protocol-Version': '1.3',
  'User-Agent': `AionUi in-app browser (Chrome/${chromeVersion})`,
  'V8-Version': process.versions.v8 ?? '',
  'WebKit-Version': '',
  webSocketDebuggerUrl: wsUrl,
});

/** /json/list ÜäÕôıÕ║ö´╝Üµ░©×┐£ÕÅ¬µ£ëÚéúõ©Çõ©¬ÚíÁÚØóÒÇé/ Always exactly one page. */
export const buildListPayload = (wsUrl: string, title: string, url: string) => [
  {
    description: '',
    devtoolsFrontendUrl: '',
    id: SINGLE_TARGET_ID,
    title,
    type: 'page',
    url,
    webSocketDebuggerUrl: wsUrl,
  },
];

/**
 * Õå│Õ«Üõ©ÇµØíÕàÑ½ÖÕæ¢õ╗ñµÇÄõ╣êÕñäÉåÒÇé
 *
 * Õà│Úö«ÕÅû×êı´╝ÜTarget.createTarget µİÄí«µèÑÚöÖ×Çîõ©ıµİ»ÚØÖÚ╗İÕ┐¢òÑÒÇé×┐Öõ©¬Õæ¢õ╗ñÜä×»¡õ╣ëµİ»ÒÇîµû░Õ╝Çõ©Çõ©¬
 * µáç¡¥ÚíÁÒÇı´╝îµêæõ╗¼ÕüÜõ©ıÕê░´╝îõ¢åÕĞéµŞ£Õüç×úàµêÉÕèşÒÇü×┐öÕøŞÚéúõ©¬Õö»õ©ÇÜä targetId´╝îAgent õ╝Üõ╗Ñõ©║×ç¬ÕÀ▒Õ╝Çõ║å
 * µû░ÚíÁÚØó´╝îÕ«ŞÚÖàõ©èÕ£¿ÕÄşÚíÁÚØóõ©è╗ğ╗¡µôıõ¢£ ÔÇöÔÇö ÚéúğıÚöÖµ│òµ»öø┤µÄÑÕñ▒×┤Ñµø┤ÚÜ¥µşÑÒÇéÕ«üÕÅ»×«®Õ«âµï┐Õê░õ©Çõ©¬
 * ×»┤µİÄµ©àµÑÜÜäÚöÖ×»»ÒÇé
 *
 * Deliberate choice: Target.createTarget errors out rather than silently no-oping.
 * It means "open a new tab", which we cannot do; pretending it succeeded and handing
 * back the one existing targetId would leave the agent believing it had a fresh page
 * while it kept driving the old one ÔÇö a failure far harder to diagnose than an explicit
 * error.
 */
export const decideCdpCommand = (req: CdpRequest, getTargetInfo: () => TargetInfo): CdpDecision => {
  const method = req.method ?? '';

  switch (method) {
    /**
     * discover:true µùÂ Chromium õ╝Ü½ïÕê╗×íÑÕÅæÕÀ▓Õ¡İÕ£¿ø«µáçÜä targetCreatedÒÇépuppeteer ÚØá
     * ×┐Öõ©¬õ║ïõ╗ÂÕ╗║½ï Target Õ»╣×▒í´╝îõ©ı×íÑÕÅæÕ«âÕ░▒õ©Çø┤¡ëÕ£¿ initialize() ÚçîÒÇé
     *
     * With discover:true Chromium backfills targetCreated for existing targets.
     * puppeteer builds its Target objects from that event and would otherwise hang
     * inside initialize().
     */
    case 'Target.setDiscoverTargets': {
      const discover = req.params?.discover === true;
      if (!discover) return { kind: 'reply', payload: {} };
      return {
        kind: 'reply-and-emit',
        payload: {},
        emit: [{ method: 'Target.targetCreated', params: { targetInfo: getTargetInfo() } }],
      };
    }

    case 'Target.setAutoAttach': {
      /**
       * ÕÅ¬µ£ëÒÇîµÁÅ×ğêÕÖ¿║ğÒÇıÜä setAutoAttach µëı×íÑÕÅæ attachedToTargetÒÇé
       *
       * Õ«ŞµÁï×©®Õê░Üäµ¡╗Õ¥¬Ä»´╝Üpuppeteer µöÂÕê░ attachedToTarget ÕÉÄõ╝Üõ©║µû░ session ÕåıÕÅæõ©Çµ¼í
       * setAutoAttach´╝êÚÇÆÕ¢ÆÚÖäÕèáÕ¡Éø«µáç´╝ë´╝îÕĞéµŞ£µêæõ╗¼Õ»╣µ»Åõ©Çµ¼íÚâ¢×íÑÕÅæ´╝îÕ░▒õ╝Ü
       * setAutoAttach ÔåÆ attachedToTarget ÔåÆ setAutoAttach ÔÇĞ µùáÚÖÉÕ¥¬Ä»´╝î
       * ×┐ŞµÄÑµ░©×┐£ÕêØÕğïÕîûõ©ıÕ«îÒÇéÕ©Ğ sessionId ÜäÚéúµ¼íõ╗ú×í¿ÒÇîÕ£¿ÚíÁÚØóõ╝Ü×»ØÚçîÚù«Õ¡Éø«µáçÒÇı´╝î
       * µêæõ╗¼µ▓íµ£ëÕ¡Éø«µáç´╝êµ▓íµ£ë iframe/worker Ú£Ç×ĞüµÜ┤Ú£▓´╝ë´╝îø┤µÄÑÕ║ö¡ö®║Õı│ÕÅ»ÒÇé
       *
       * Only the browser-level setAutoAttach backfills attachedToTarget. Testing hit an
       * infinite loop: on receiving attachedToTarget puppeteer issues another setAutoAttach
       * on the new session (to recurse into sub-targets), so backfilling on every call
       * produced setAutoAttach ÔåÆ attachedToTarget ÔåÆ setAutoAttach ÔÇĞ forever and the
       * connection never finished initialising. The call carrying a sessionId means "list
       * sub-targets within the page session"; we expose none, so an empty ack is correct.
       */
      const isBrowserLevel = req.sessionId === undefined || req.sessionId === '';
      if (!isBrowserLevel) return { kind: 'reply', payload: {} };

      /**
       * Õ┐àÚí╗õ©╗Õè¿×íÑÕÅæ attachedToTarget´╝îÕÉĞÕêÖ puppeteer ×«ñõ©ıÕç║×┐Öõ©¬ÚíÁÚØóÒÇé
       *
       * puppeteer Üä TargetManager.getAvailableTargets() ×┐öÕøŞÜäµİ»
       * #attachedTargetsByTargetId ÔÇöÔÇö ÕÅ¬µ£ëÒÇîÕÀ▓ÚÖäÕèáÒÇıÜäø«µáçµëı«ùµò░´╝î×ÇîÒÇîÕÀ▓ÚÖäÕèáÒÇıÕÅ¬ö▒
       * attachedToTarget õ║ïõ╗ÂÕ╗║½ïÒÇétargetCreated ÕÅ¬×┐ø discovered Õêù×í¿´╝î
       * µëÇõ╗ÑÕÅ¬ÕÅæ targetCreated õ╝Ü×«® browser.pages() ×┐öÕøŞ 0ÒÇé
       *
       * filter ÚçîÜä {type:'page', exclude:true} £ïØÇÕâÅÒÇîÕê½×ç¬Õè¿ÚÖäÕèáÚíÁÚØóÒÇı´╝îõ¢åÚéú«íÜäµİ»
       * ×┐É×íîõ©¡µû░Õ╝ÇÜäÚíÁÚØó´╝øÕ»╣×┐ŞµÄÑµùÂÕ░▒ÕÀ▓Õ¡İÕ£¿ÜäÚíÁÚØó´╝î£şÕ«Ş Chrome õ╝ÜÕ£¿ setAutoAttach µùÂ
       * ø┤µÄÑ×íÑÕÅæ attachedToTargetÒÇéµêæõ╗¼Úéúõ©¬Õ©©Ú®╗ÚíÁÚØóÕ▒Şõ║ÄÕÉÄ×ÇàÒÇé
       *
       * We must proactively emit attachedToTarget or puppeteer never recognises the page:
       * getAvailableTargets() returns #attachedTargetsByTargetId, and only the
       * attachedToTarget event establishes attachment. targetCreated merely populates the
       * discovered list, so emitting it alone leaves browser.pages() at 0.
       *
       * The {type:'page', exclude:true} filter looks like "do not auto-attach pages", but
       * that governs pages opened later; for pages already present at connect time real
       * Chrome backfills attachedToTarget during setAutoAttach. Our persistent page is that
       * case.
       */
      return {
        kind: 'reply-and-emit',
        payload: {},
        emit: [
          {
            method: 'Target.attachedToTarget',
            params: { sessionId: SINGLE_SESSION_ID, targetInfo: getTargetInfo(), waitingForDebugger: false },
          },
        ],
      };
    }

    case 'Target.getTargets':
      return { kind: 'reply', payload: { targetInfos: [getTargetInfo()] } };

    case 'Target.getTargetInfo':
      return { kind: 'reply', payload: { targetInfo: getTargetInfo() } };

    case 'Target.getBrowserContexts':
      return { kind: 'reply', payload: { browserContextIds: [SINGLE_BROWSER_CONTEXT_ID] } };

    /**
     * ÕÅ¬Õàü×«©ÚÖäÕèáÕê░µêæõ╗¼Õö»õ©ÇÜäø«µáç´╝øÕàÂÕ«â id ø┤µÄÑµèÑÚöÖ´╝îÚü┐Õàıµèè×»Àµ▒é×¢¼╗Öõ©Çõ©¬õ©ıÕ¡İÕ£¿Üäõ╝Ü×»ØÒÇé
     * attachedToTarget õ║ïõ╗ÂÕ©Ğ sessionId´╝îflatten µ¿íÕ╝Åõ©ï puppeteer õ¥Ø×ÁûÕ«â×À»ö▒ÕÉÄ╗¡Õæ¢õ╗ñÒÇé
     *
     * Only our single target may be attached; any other id errors out instead of being
     * routed to a session that does not exist. The attachedToTarget event carries the
     * sessionId that puppeteer uses to route later commands in flatten mode.
     */
    case 'Target.attachToTarget': {
      const requested = req.params?.targetId;
      if (typeof requested === 'string' && requested !== SINGLE_TARGET_ID) {
        return { kind: 'error', message: `No such target id: ${requested}` };
      }
      return {
        kind: 'reply-and-emit',
        payload: { sessionId: SINGLE_SESSION_ID },
        emit: [
          {
            method: 'Target.attachedToTarget',
            params: { sessionId: SINGLE_SESSION_ID, targetInfo: getTargetInfo(), waitingForDebugger: false },
          },
        ],
      };
    }

    case 'Target.detachFromTarget':
    case 'Target.closeTarget':
      // Õà│µÄëõ¥ğ×¥╣µÁÅ×ğêÕÖ¿õ©ı×»Ñö▒ Agent Õå│Õ«Ü´╝îÚØÖÚ╗İÕ║ö¡öÕı│ÕÅ»ÒÇé
      // Closing the in-app browser is not the agent's call; acknowledge and do nothing.
      return { kind: 'reply', payload: {} };

    case 'Target.createTarget':
      return {
        kind: 'error',
        message: 'AionUi in-app browser exposes a single fixed tab; Target.createTarget is not supported.',
      };

    case 'Target.createBrowserContext':
    case 'Target.disposeBrowserContext':
      return { kind: 'error', message: 'AionUi in-app browser does not support multiple browser contexts.' };

    /**
     * Browser.close õ╝ÜÕà│µÄëµò┤õ©¬Õ║öö¿ ÔÇöÔÇö ╗Øõ©ı×â¢×«® Agent ×ğĞÕÅæÒÇé
     * Browser.close would terminate the whole app; never let the agent reach it.
     */
    case 'Browser.close':
      return { kind: 'error', message: 'Browser.close is not permitted against the AionUi in-app browser.' };

    default:
      return { kind: 'forward' };
  }
};

/**
 * Õêñµû¡ÕàÑ½Ö sessionId µİ»ÕÉĞÕÅ»µÄÑÕÅùÒÇé
 *
 * ®║ sessionId = µÁÅ×ğêÕÖ¿║ğÕæ¢õ╗ñ´╝øµêæõ╗¼Úéúõ©¬Õø║Õ«Ü session = ÚíÁÚØó║ğÒÇéÕàÂõ¢Öõ©ÇÕ¥ïµïÆ╗Ø´╝î
 * ×Çîõ©ıµİ»Õ¢ôµêÉµÁÅ×ğêÕÖ¿║ğµö¥×┐çÕÄ╗ ÔÇöÔÇö ÚØÖÚ╗İµö¥×íîõ╝Ü×«®ÚöÖ×À»ö▒ÜäÕæ¢õ╗ñ£ï×ÁÀµØÑÒÇîµêÉÕèşÒÇıÒÇé
 *
 * An empty sessionId means a browser-level command; our fixed session means page level.
 * Anything else is rejected rather than quietly treated as browser-level, since letting
 * it through would make a misrouted command look like it succeeded.
 */
export const isAcceptableSessionId = (sessionId: string | undefined): boolean =>
  sessionId === undefined || sessionId === '' || sessionId === SINGLE_SESSION_ID;

/** Õ©©ÚçÅµùÂÚù┤µ»ö×¥â´╝îÚü┐Õàıö¿Õ¡ù¼Ğõ©▓µ»ö×¥âµ│äµ╝Å token Õëı╝Çõ┐íµü»ÒÇé/ Constant-time compare so token prefixes do not leak. */
export const tokensMatch = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
};
