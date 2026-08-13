/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ×ğúµŞÉÕ║öö¿ÕåàµÁÅ×ğêÕÖ¿ MCP ×»Ñ×┐ŞµÄÑÜä CDP Õ£░ÕØÇÒÇé
 *
 * Õıòï¼µêÉµûçõ╗Âµİ»õ©║õ║åÕÅ»µÁï×»ò´╝ÜbrowserServer.ts µİ»õ©¬µ£ëÚíÂÕ▒éÕë»õ¢£ö¿ÜäÕÉ»Õè¿×äÜµ£¼´╝êõ╝Ü spawn
 * Õ¡É×┐ø¿ï´╝ë´╝îµ▓íµ│òø┤µÄÑÕ£¿ÕıòµÁïÚçî importÒÇé
 *
 * Resolves which CDP endpoint the in-app browser MCP should connect to. Kept in
 * its own module for testability: browserServer.ts is an entry script with
 * top-level side effects (it spawns a child), so it cannot be imported by tests.
 */

const DEFAULT_CDP_HOST = '127.0.0.1';

export type ResolveBrowserUrlDeps = {
  env: NodeJS.ProcessEnv;
};

const toBrowserUrl = (port: number): string | null => {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return `http://${DEFAULT_CDP_HOST}:${port}`;
};

/**
 * ÕÅ¬×«ñ×ç¬ÕÀ▒×┐ø¿ïµáæ╗ğµë┐õ©ïµØÑÜä½»ÕÅúÒÇé
 *
 * ½»ÕÅúö▒ Electron õ©╗×┐ø¿ïÕåÖ×┐ø AIONUI_CDP_ACTIVE_PORT´╝î╗Å aioncore ╗ğµë┐Õê░×┐ÖÚçî´╝îµëÇõ╗Ñ
 * ÒÇîµï┐õ©ıÕê░ÒÇıÕÅ¬µ£ëõ©ñğıµâàÕåÁ´╝ÜCDP ×ó½ö¿µêÀÕà│µÄëõ║å´╝îµêû×Çàõ©ıµİ»õ╗ÄÕ║öö¿ÚçîÕÉ»Õè¿ÜäÒÇéõ©ñğıµâàÕåÁÚâ¢Õ║öÕ¢ô
 * µïÆ╗ØÕÉ»Õè¿´╝î×Çîõ©ıµİ»ÕÄ╗î£õ©Çõ©¬½»ÕÅúÔÇöÔÇöî£ÚöÖõ╝Üµèè Agent ×┐ŞÕê░ÕÅĞõ©Çõ©¬Õ«Şõ¥ïÜäµÁÅ×ğêÕÖ¿õ©èÒÇé
 *
 * Only trust the port inherited down this process tree. The Electron main process
 * writes it into AIONUI_CDP_ACTIVE_PORT and aioncore passes it down, so failing to
 * read it means one of two things: the user disabled CDP, or this was not launched by
 * the app. Both must refuse to start rather than guess a port ÔÇö guessing wrong
 * connects the agent to a *different* instance's browser.
 */
export const resolveBrowserUrl = (deps: ResolveBrowserUrlDeps): string | null => {
  const { env } = deps;

  const rawPort = env.AIONUI_CDP_ACTIVE_PORT?.trim();
  if (rawPort) {
    const fromEnv = toBrowserUrl(Number(rawPort));
    if (fromEnv) return fromEnv;
  }

  return null;
};

/**
 * Õıòø«µáç CDP ÚÇÜÚüôÜä×«┐Úù«ÕÅúõ╗ñÒÇé
 *
 * ÕÅúõ╗ñö▒õ©╗×┐ø¿ïÚÜÅµ£║öşµêÉÕÉÄÕåÖ×┐ø env´╝îÚí║ØÇ×┐ø¿ï╗ğµë┐Úô¥õ╝áÕê░×┐ÖÚçîÒÇéÕ«âÜäõ¢£ö¿µİ»**Úİ╗µ¡óø▓×┐Ş**´╝Ü
 * µ▓í×»╗×┐çÕÅæÄ░µ«ÁÒÇüõ©ıÕ©ĞÕÅúõ╗ñÜä×┐ŞµÄÑõ©ÇÕ¥ï×ó½ÚÇÜÚüô 403 µÄëÒÇé
 *
 * õ¢åÕ«â**õ©ıµİ»×║½õ╗¢×»üµİÄ** ÔÇöÔÇö HTTP ÕÅæÄ░µ«Áõ©ıÚë┤µØâõ©öÕôıÕ║öÚçîÕ░▒Õ©ĞØÇÕÅúõ╗ñ´╝îÕÉîµ£║ÕÉîö¿µêÀÜäõ╗╗µäÅ×┐ø¿ï
 * õ©Çõ©¬ GET Õ░▒×â¢ÕÅûÕøŞµØÑ´╝ê×»Ğ×ğü cdpBridge.ts ÚçîÜäÕ¿ü×âüµ¿íÕŞï×»┤µİÄ´╝ëÒÇéµëÇõ╗Ñ×┐ÖÚçî×Ğüµ▒é env Úçîµ£ëÕÅúõ╗ñ´╝î
 * £şµ¡úÜäµäÅõ╣ëµİ»ÒÇîÚÇÜÚüôí«Õ«Ş×ÁÀµØÑõ║åÒÇıÜäÕç¡×»ü´╝Ü╝║õ║åÕ░▒×»┤µİÄµíÑµ▓í×ÁÀ´╝êµêû CDP ×ó½Õà│µÄëõ║å´╝ë´╝îµ¡ñµùÂÕ┐àÚí╗
 * ÚÇÇÕç║´╝î×Çîõ©ıµİ»×«® MCP ÕøŞÚÇÇÕÄ╗Õ╝Çõ©Çõ©¬ö¿µêÀ£ïõ©ı×ğüÜäï¼½ï ChromeÒÇé
 *
 * Access token for the single-target CDP bridge. The main process generates it randomly and
 * writes it into the env, from where it travels down the process inheritance chain. Its job is
 * to **prevent blind connections**: anything connecting without it (i.e. without having read
 * discovery) is refused with a 403.
 *
 * It is **not proof of identity** ÔÇö HTTP discovery is unauthenticated and its response embeds
 * the token, so any process running as the same user can fetch it with one GET (see the threat
 * model note in cdpBridge.ts). Requiring it here really means "the bridge is up": its absence
 * means there is no bridge (or CDP is switched off), and we must exit rather than let the MCP
 * fall back to spawning a separate Chrome the user cannot see.
 */
export const resolveBridgeToken = (deps: ResolveBrowserUrlDeps): string | null => {
  const raw = deps.env.AIONUI_CDP_BRIDGE_TOKEN?.trim();
  return raw ? raw : null;
};

/**
 * Õå│Õ«Üö¿õ╗Çõ╣êÕæ¢õ╗ñ×íîµïë×ÁÀ chrome-devtools-mcpÒÇé
 *
 * µè¢Õê░×┐ÖÚçîÕÅ¬õ©║ÕÅ»µÁï´╝ÜbrowserServer.ts ÚíÂÕ▒éÕ░▒ spawn´╝îÕıòµÁïµ▓íµ│ò import Õ«â´╝îõ║Äµİ» Windows
 * ÚéúµØíÕêåµö»õ╗ÑÕëıÕ«îÕà¿µ▓íµ£ëµÁï×»ò×Ğåøû ÔÇöÔÇö ×┐Öµ¡úµİ» issue #3883 ×â¢µ║£×┐çÕÄ╗ÜäÕÄşÕøáÒÇé
 *
 * Windows õ©è npx µİ» npx.cmd´╝îµë╣ÕñäÉåµûçõ╗Âµ▓íµ£ë╗ê½»µùáµ│ò×ç¬ÕÀ▒µëğ×íî´╝îø┤µÄÑ spawn õ╝Üµèø EINVAL
 * ´╝êCVE-2024-27980 õ╣ïÕÉÄ Node µöÂ┤ğõ║å .cmd ÕñäÉå´╝ëÒÇé×┐ÖÚçî×Á░ cmd.exe /c ×Çîõ©ıµİ» shell: true´╝î
 * Éåö▒×ğü browserServer.ts ÚçîÜä×»Ğ╗å×»┤µİÄ´╝êDEP0190 + browserUrl õ╝Ü×ó½ shell ×ğúµŞÉ´╝ëÒÇé
 *
 * Decides the command line used to launch chrome-devtools-mcp. Extracted purely for
 * testability: browserServer.ts spawns at module scope so tests cannot import it, which left
 * the Windows branch with no coverage at all ÔÇö the reason issue #3883 slipped through.
 *
 * On Windows npx is npx.cmd, a batch file that cannot execute without a terminal, so spawning
 * it directly throws EINVAL (Node tightened .cmd handling after CVE-2024-27980). We route
 * through cmd.exe /c rather than shell: true; see browserServer.ts for the full rationale
 * (DEP0190, plus browserUrl would be parsed by the shell).
 */
export const buildMcpSpawnCommand = (deps: {
  platform: string;
  version: string;
  browserUrl: string;
}): { command: string; args: string[] } => {
  const mcpArgs = ['-y', `chrome-devtools-mcp@${deps.version}`, '--browser-url', deps.browserUrl];
  return deps.platform === 'win32'
    ? { command: 'cmd.exe', args: ['/c', 'npx', ...mcpArgs] }
    : { command: 'npx', args: mcpArgs };
};
