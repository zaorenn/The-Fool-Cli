/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * õ╗ÄÕÀÑÕàÀ×░âö¿µÁüÚçî×»åÕê½ÒÇîAgent µ¡úÕ£¿µôıõ¢£Õ║öö¿ÕåàµÁÅ×ğêÕÖ¿ÒÇıÒÇé
 *
 * ║»Õç¢µò░ÒÇüµùáÕë»õ¢£ö¿´╝îÕøáµ¡ñÕÅ»õ╗ÑÕıòµÁï ÔÇöÔÇö ×┐Öµ«ÁÕêñµû¡Üäµ¡úí«µÇğÕ¥êÚçı×Ğü´╝ÜÕêñÚöÖõ║åõ╝ÜÕ»╝×ç┤
 * ×ğÆµáçÕ©©õ║«µêû×Çàµ░©õ©ıõ║«´╝î×Çî×┐Öµ¡úµİ»ö¿µêÀÉå×ğú"ÕêÜµëıÕÅæöşõ║åõ╗Çõ╣ê"ÜäÕö»õ©Ç║┐┤óÒÇé
 *
 * Detects "the agent is driving the in-app browser" from the tool-call stream.
 * Kept pure and side-effect free so it can be unit tested: getting this wrong
 * leaves the activity badge either permanently on or never on, and it is the
 * user's only cue about what just happened.
 */

/**
 * Õåà¢«µÁÅ×ğêÕÖ¿ MCP Üäµ│¿ÕåîÕÉı´╝îÕ«Üõ╣ëÕ£¿ common õ╗Ñõ¥┐õ©╗×┐ø¿ïµ│¿ÕåîÒÇüµ©▓µşô×┐ø¿ï×»åÕê½ö¿ÕÉîõ©Çõ╗¢ÕÇ╝ÒÇé
 * õ╗Ä×┐ÖÚçîÚçıµû░Õ»╝Õç║´╝îµû╣õ¥┐µ£¼ø«Õ¢òÕåàÕ░▒×┐æÕÅûö¿ÒÇé
 *
 * Registered name of the built-in browser MCP. Defined in common so the main
 * process (which registers it) and the renderer (which recognises it) share one
 * value; re-exported here for local use within this directory.
 */
export { BUILTIN_BROWSER_MCP_NAME } from '@/common/config/constants';

import { BUILTIN_BROWSER_MCP_NAME } from '@/common/config/constants';

/**
 * ÕÀÑÕàÀµëğ×íîõ©¡ÜäèÂµÇüÒÇé
 *
 * `Confirming` õ╣ş«ù"×┐ø×íîõ©¡"´╝Üµ¡ñµùÂ Agent ÕÀ▓╗ÅÕ£¿¡ëö¿µêÀµë╣ÕçåµşÉõ©¬µÁÅ×ğêÕÖ¿µôıõ¢£´╝î
 * ö¿µêÀµø┤Ú£Ç×ĞüşÑÚüôµ│¿µäÅÕèø×»Ñµö¥Õô¬Õä┐ÒÇé
 *
 * Statuses that count as in-flight. `Confirming` is included: at that point the
 * agent is waiting for approval of a browser action, which is exactly when the
 * user most needs to know where to look.
 */
const IN_FLIGHT_STATUSES = new Set(['Executing', 'Pending', 'Confirming']);

type ToolGroupEntry = {
  name?: string;
  status?: string;
  confirmationDetails?: { type?: string; server_name?: string } | Record<string, unknown>;
};

const isBrowserMcpEntry = (entry: ToolGroupEntry): boolean => {
  const details = entry.confirmationDetails as { type?: string; server_name?: string } | undefined;
  if (details?.type === 'mcp' && details.server_name === BUILTIN_BROWSER_MCP_NAME) return true;

  /**
   * Õà£Õ║òµîëÕÀÑÕàÀÕÉıÕëı╝ÇÕî╣Úàı´╝Üõ©ıÕÉîÕ╝òµôÄÕ»╣ MCP ÕÀÑÕàÀÜäÕæ¢ÕÉıµû╣Õ╝Åõ©ıõ©Ç×ç┤´╝îµ£ëÜäõ╝ÜÕ©Ğ
   * `<server>__<tool>` Õëı╝Ç×Çîõ©ıÕí½ confirmationDetailsÒÇéÕ░æ×«ñõ©Çµ¼íµ»ö×»»×«ñõ©Çµ¼íÕÑ¢´╝î
   * õ¢å×┐Öõ©ñµØí×Ğåøûõ║åø«ÕëıµëÇµ£ëÕÀ▓şÑÕ¢óµÇüÒÇé
   *
   * Fall back to the tool-name prefix: engines differ in how they name MCP tools,
   * and some emit `<server>__<tool>` without confirmationDetails. Under-detecting
   * beats over-detecting, but these two checks cover every known shape today.
   */
  const name = entry.name;
  if (typeof name === 'string' && name.startsWith(`${BUILTIN_BROWSER_MCP_NAME}__`)) return true;

  return false;
};

/**
 * Õêñµû¡õ©ÇµØí tool_group µÂêµü»µİ»ÕÉĞ×í¿ñ║ Agent µ¡úÕ£¿µôıõ¢£µÁÅ×ğêÕÖ¿ÒÇé
 * Whether a tool_group message means the agent is currently driving the browser.
 */
export const isBrowserMcpActivity = (messageType: string, data: unknown): boolean => {
  if (messageType !== 'tool_group') return false;
  if (!Array.isArray(data)) return false;

  return (data as ToolGroupEntry[]).some(
    (entry) => isBrowserMcpEntry(entry) && IN_FLIGHT_STATUSES.has(String(entry.status))
  );
};

/**
 * Õêñµû¡õ©ÇµØí tool_group µÂêµü»µİ»ÕÉĞ×í¿ñ║µÁÅ×ğêÕÖ¿µôıõ¢£ÕÀ▓╗Å╗ôµØş´╝êµêÉÕèşµêûÕñ▒×┤Ñ´╝ëÒÇé
 *
 * Õıòï¼Õêñµû¡"╗ôµØş"×Çîõ©ıµİ»ÚØá"õ©ıÕ£¿×┐ø×íîõ©¡"ÕÅûÕÅı´╝Üõ©ÇµØíµÂêµü»ÚçîÕÅ»×â¢ÕÉîµùÂµ£ëÕê½ÜäÕÀÑÕàÀ´╝î
 * ÕÅûÕÅıõ╝ÜµèèµùáÕà│µÂêµü»×»»ÕêñµêÉ"µÁÅ×ğêÕÖ¿µôıõ¢£╗ôµØş"´╝î×ğÆµáçÕ░▒õ╝ÜµÅÉÕëıåäü¡ÒÇé
 *
 * Whether a tool_group message means a browser action has finished (either way).
 * Detected explicitly rather than as the negation of in-flight: a single message
 * may carry unrelated tools, and negating would misread those as "browser done",
 * extinguishing the badge too early.
 */
export const isBrowserMcpSettled = (messageType: string, data: unknown): boolean => {
  if (messageType !== 'tool_group') return false;
  if (!Array.isArray(data)) return false;

  const entries = (data as ToolGroupEntry[]).filter(isBrowserMcpEntry);
  if (entries.length === 0) return false;

  return entries.every((entry) => !IN_FLIGHT_STATUSES.has(String(entry.status)));
};
