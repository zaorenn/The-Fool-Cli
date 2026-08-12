/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Agent ÚĞûµ¼íµôıõ¢£Õ║öö¿ÕåàµÁÅ×ğêÕÖ¿µùÂÜäõ©Çµ¼íµÇğµÅÉñ║ÒÇé
 *
 * ×«¥×«í║ĞµØş´╝êµØÑ×ç¬õ║ğÕôüÕå│¡û´╝ë´╝Üõ©ıÚİ╗µû¡ÒÇüõ©ıÚ£Ç×Ğüö¿µêÀí«×«ñÒÇéö¿µêÀ¼¼õ©Çµ¼í£ïÕê░õ¥ğ×¥╣µÁÅ×ğêÕÖ¿
 * ×ç¬ÕÀ▒Õè¿×ÁÀµØÑµùÂõ╝ÜÕø░µâæ"×┐Öµİ»×░üÕ£¿µôıõ¢£"´╝îµëÇõ╗Ñ×Ğü×»┤õ©ÇÕÅÑ´╝øõ¢å×┐Öµİ»Úóäµ£ş×íîõ©║´╝îõ©ı×»Ñµï┐Õ╝╣¬ù
 * µïĞõ¢Å Agent Õ╣▓µ┤╗ÒÇé
 *
 * One-time notice shown the first time the agent drives the in-app browser.
 * Product constraint: non-blocking and requiring no confirmation. The first time a
 * user sees the side browser move by itself they wonder who is doing it, so it
 * needs saying ÔÇö but this is expected behavior and must not block the agent behind
 * a modal.
 */

import { Notification } from '@arco-design/web-react';
import i18next from 'i18next';

/**
 * µÅÉñ║µİ»ÕÉĞÕÀ▓Õ▒òñ║×┐çÒÇéö¿ localStorage ×Çîõ©ıµİ»ÕåàÕ¡İµáç×«░´╝îµİ»Õøáõ©║"ÚĞûµ¼í"µîçÜäµİ»
 * ×┐ÖÕÅ░µ£║ÕÖ¿õ©èÜäÚĞûµ¼í´╝îÚçıÕÉ»Õ║öö¿ÕÉÄõ©ı×»ÑÕåıµÅÉñ║õ©ÇÚüıÒÇé
 *
 * Whether the notice has been shown. Stored in localStorage rather than memory
 * because "first time" means first time on this machine ÔÇö restarting the app must
 * not show it again.
 */
const FIRST_USE_STORAGE_KEY = 'aionui_agent_browser_first_use_notified';

/**
 * ×┐ø¿ïÕåàµáç×«░´╝îÚİ▓µ¡óÕÉîõ©Çµ¼íõ╝Ü×»ØÚçî×┐Ş╗¡ÜäÕÀÑÕàÀ×░âö¿ÚçıÕñıÕ╝╣µÅÉñ║ÒÇé
 * localStorage ÕåÖÕàÑµİ»ÕÉîµ¡ÑÜä´╝îõ¢å×»╗ÕÅûÕêñµû¡ÕÆîÕåÖÕàÑõ╣ïÚù┤õ╗ıÕÅ»×â¢×┐Ş╗¡×ğĞÕÅæÕñÜµ¼íÒÇé
 *
 * In-process guard against duplicate notices from back-to-back tool calls within a
 * single session: localStorage writes are synchronous, but several events can still
 * fire between the read and the write.
 */
let notifiedThisSession = false;

const hasNotified = (): boolean => {
  if (notifiedThisSession) return true;
  try {
    return localStorage.getItem(FIRST_USE_STORAGE_KEY) === '1';
  } catch {
    // localStorage õ©ıÕÅ»ö¿µùÂÕ«üÕÅ»õ©ıµÅÉñ║´╝îõ╣şõ©ı×Ğüµ»Åµ¼íÚâ¢Õ╝╣
    // If localStorage is unavailable, prefer never notifying over notifying always.
    return true;
  }
};

const rememberNotified = (): void => {
  notifiedThisSession = true;
  try {
    localStorage.setItem(FIRST_USE_STORAGE_KEY, '1');
  } catch {
    // Non-critical: the in-process guard still prevents repeats this session.
  }
};

/**
 * ×ïÑÕ░Üµ£¬µÅÉñ║×┐ç´╝îÕêÖÕ▒òñ║õ©Çµ¼íµÇğµÅÉñ║ÒÇéÕÀ▓µÅÉñ║×┐çµùÂõ©║®║µôıõ¢£ÒÇé
 * Shows the one-time notice unless it has already been shown. No-op otherwise.
 */
export const maybeNotifyFirstAgentBrowserUse = (): void => {
  if (hasNotified()) return;
  rememberNotified();

  Notification.info({
    // ø┤µÄÑö¿ i18next Õıòõ¥ï×ÇîÚØŞ @/renderer/services/i18n´╝ÜÕÉÄ×ÇàÕ£¿µ¿íÕØùÕèá×¢¢µùÂÕ░▒õ╝Ü
    // ÕêØÕğïÕîû i18n Õ╣Â×«óÚİà IPC´╝îµèè×┐Öõ║øÕë»õ¢£ö¿µïû×┐øõ╗╗õ¢ò import µ£¼µûçõ╗ÂÜäµ¿íÕØùÚçîÒÇé
    // Use the i18next singleton rather than @/renderer/services/i18n: the latter
    // initializes i18n and subscribes to IPC at module load, dragging those side
    // effects into anything that imports this file.
    title: i18next.t('preview.browser.agentFirstUseTitle'),
    content: i18next.t('preview.browser.agentFirstUseContent'),
    duration: 8000,
  });
};
