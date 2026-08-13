/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Õ║öö¿ÕåàµÁÅ×ğêÕÖ¿ tab ÜäÕà▒õ║½Õ©©ÚçÅõ©ÄÕ£░ÕØÇµáÅ×¥ôÕàÑ×ğúµŞÉ
 * Shared constants and address-bar input parsing for in-app browser tabs
 */

/**
 * õ╗Ä common Úçıµû░Õ»╝Õç║´╝îµû╣õ¥┐µÁÅ×ğêÕÖ¿ø©Õà│õ╗úáüÕ░▒×┐æÕÅûö¿ÒÇé
 * Õ«Üõ╣ëÕ£¿ common µİ»Õøáõ©║õ©╗×┐ø¿ïµ©àÉåÖ╗Õ¢òµÇüµùÂõ╣ş×Ğüö¿ÕÉîõ©Çõ©¬ÕÇ╝ÒÇé
 *
 * Re-exported from common so browser code can reach it locally. It is defined in
 * common because the main process needs the same value when clearing sign-in state.
 */
export { BROWSER_SESSION_PARTITION } from '@/common/config/constants';

/** µû░Õ╗║µÁÅ×ğêÕÖ¿ tab ÜäÕêØÕğïÕ£░ÕØÇ / Initial address for a freshly opened browser tab. */
export const BROWSER_BLANK_URL = 'about:blank';

/**
 * µÁÅ×ğêÕÖ¿ tab ÜäÕıáõ¢ıµáçÚóİ´╝îÚíÁÚØóµáçÚóİÕ░▒╗¬ÕÉÄõ╝Ü×ó½µø┐µıóÒÇé
 * Placeholder title for a browser tab, replaced once the page title arrives.
 */
export const BROWSER_TAB_FALLBACK_TITLE = 'New Tab';

/**
 * µÁÅ×ğêÕÖ¿ tab µò░ÚçÅõ©èÚÖÉ´╝Ü×Âà×┐çÕêÖµÅÉñ║ö¿µêÀÕàêÕà│Úù¡µùğ tab´╝îÚü┐Õàıµ»Åõ©¬ tab õ©Çõ©¬ webview
 * ×┐ø¿ïµèèÕåàÕ¡İÕÉâµ╗íÒÇé
 *
 * Cap on browser tabs: each tab is a separate webview process, so an unbounded
 * count would exhaust memory. Beyond this the user is asked to close old tabs.
 */
export const MAX_BROWSER_TABS = 10;

/** Ú╗İ×«ñµÉ£┤óÕ╝òµôÄ´╝îÕ£░ÕØÇµáÅ×¥ôÕàÑÚØŞ URL µùÂõ¢┐ö¿ / Default search engine for non-URL input. */
const SEARCH_URL_TEMPLATE = 'https://www.bing.com/search?q={query}';

/**
 * ÕÀ▓şÑÜäµùáõ©╗µ£║ÕÉı scheme´╝Ü×┐Öõ║øø┤µÄÑÕÄşµáÀÚÇÜ×┐ç´╝îõ©ıÕüÜÕşşÕÉıî£µÁïÒÇé
 * Schemes with no host part ÔÇö passed through untouched, never guessed at.
 */
const PASSTHROUGH_SCHEMES = ['about:', 'data:', 'blob:', 'chrome:', 'devtools:', 'view-source:'];

/** µİ¥Õ╝ÅÕ©Ğ scheme Üä×¥ôÕàÑ / Input that explicitly carries a scheme. */
const EXPLICIT_SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * £ï×ÁÀµØÑÕâÅõ©╗µ£║ÕÉıÜä×¥ôÕàÑ´╝Ü`example.com`ÒÇü`localhost:3000`ÒÇü`192.168.1.5/x`ÒÇé
 * ×Ğüµ▒éÚĞûµ«Áõ╣ïÕÉÄÕ¡İÕ£¿õ©Çõ©¬ TLD Õ╝ÅÕÉÄ╝Ç´╝îµêûµİ»Õ©Ğ½»ÕÅúÜä localhost / IPÒÇé
 *
 * Host-like input: `example.com`, `localhost:3000`, `192.168.1.5/x`. Requires a
 * TLD-ish suffix, or localhost/IP with a port.
 */
const HOST_LIKE_RE = /^(?:[\w-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i;
const LOCALHOST_RE = /^localhost(?::\d+)?(?:[/?#].*)?$/i;
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:[/?#].*)?$/;

/**
 * µèèÕ£░ÕØÇµáÅ×¥ôÕàÑ×ğúµŞÉµêÉÕÅ»Õ»╝×ê¬Üä URLÒÇé
 *
 * ×¥ôÕàÑÕÅ»×â¢µİ»Õ«îµò┤ URLÒÇü×ú©ÕşşÕÉı´╝îµêûõ©ÇÕÅÑ×ĞüµÉ£┤óÜä×»Ø ÔÇöÔÇö ×┐Öõ©¬Õç¢µò░Õå│Õ«ÜÕÄ╗Õô¬ÒÇé
 * ÕÉ½®║µá╝Üä×¥ôÕàÑõ©ÇÕ¥ïÕ¢ôµÉ£┤ó×»ı´╝Ü`example.com/a b` õ©ıµİ»µ£ëµòêõ©╗µ£║ÕÉı´╝î×Çî
 * "ÕĞéõ¢òÚàı¢« nginx" µİÄµİ¥µİ»Õ£¿µÉ£õ©£×Ñ┐ÒÇé
 *
 * Resolve address-bar input into a navigable URL. Input may be a full URL, a
 * bare hostname, or a search phrase. Anything containing whitespace is treated
 * as a search query.
 */
export const resolveAddressBarInput = (raw: string): string | null => {
  const input = raw.trim();
  if (!input) return null;

  const lower = input.toLowerCase();
  if (PASSTHROUGH_SCHEMES.some((scheme) => lower.startsWith(scheme))) return input;
  if (EXPLICIT_SCHEME_RE.test(input)) return input;

  // Whitespace never appears in a hostname, so this is a search phrase.
  if (!/\s/.test(input)) {
    if (LOCALHOST_RE.test(input) || IPV4_RE.test(input) || HOST_LIKE_RE.test(input)) {
      return `https://${input}`;
    }
  }

  return SEARCH_URL_TEMPLATE.replace('{query}', encodeURIComponent(input));
};

/**
 * õ¥ø tab µáçÚóİõ¢┐ö¿Üä┤ğÕçæµáç¡¥´╝îÚíÁÚØó×┐İµ▓í╗ÖÕç║µáçÚóİµùÂö¿õ©╗µ£║ÕÉıÕà£Õ║òÒÇé
 * Compact label for a tab title, falling back to the hostname before a real
 * page title arrives.
 */
export const browserTabLabelFromUrl = (url: string): string => {
  if (!url || url === BROWSER_BLANK_URL) return BROWSER_TAB_FALLBACK_TITLE;
  try {
    const parsed = new URL(url);
    return parsed.hostname || BROWSER_TAB_FALLBACK_TITLE;
  } catch {
    return BROWSER_TAB_FALLBACK_TITLE;
  }
};
