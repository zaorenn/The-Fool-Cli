/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback } from 'react';
import WebviewHost from '@/renderer/components/media/WebviewHost';
import {
  BROWSER_BLANK_URL,
  BROWSER_SESSION_PARTITION,
  browserTabLabelFromUrl,
  resolveAddressBarInput,
} from './constants';

export interface BrowserViewerProps {
  /** ×»Ñ tab Õ¢ôÕëıÕ£░ÕØÇ / Current address of this tab */
  url: string;
  /** µëÇÕ▒Ş preview tab Üä id / Id of the owning preview tab */
  tabId: string;
  /** Õ£░ÕØÇÕÅİÕîûµùÂÕøŞÕåÖ tab´╝êö¿õ║Äµîüõ╣àÕîû´╝ë/ Persist the new address back onto the tab */
  onUrlChange: (tabId: string, url: string) => void;
  /** ÚíÁÚØóµáçÚóİÕÅİÕîûµùÂÕøŞÕåÖ tab / Persist the page title back onto the tab */
  onTitleChange: (tabId: string, title: string) => void;
  /** ½Öé╣Õø¥µáçÕÅİÕîûµùÂÕøŞÕåÖ tab / Persist the site favicon back onto the tab */
  onFaviconChange: (tabId: string, favicon: string) => void;
}

/**
 * Õ║öö¿ÕåàµÁÅ×ğêÕÖ¿×ğåÕø¥ / In-app browser view.
 *
 * õ©Ä URLViewer ÜäÕî║Õê½Õ£¿õ©ëé╣´╝îõ╣şµ¡úµİ»Õ«âÕıòï¼Õ¡İÕ£¿ÜäÉåö▒´╝Ü
 * 1. õ¢┐ö¿Õà▒õ║½Üäµîüõ╣àÕîû partition´╝îÖ╗Õ¢òµÇü×À¿ tab / ×À¿Úí╣ø«õ┐ØòÖ´╝ø
 * 2. Õ£░ÕØÇµáÅµö»µîüÒÇî×¥ôÕàÑÕà│Úö«×»ıø┤µÄÑµÉ£┤óÒÇı´╝îõ©ıÕÅ¬µİ»×íÑ https://´╝ø
 * 3. µèèÕ£░ÕØÇ / µáçÚóİ / Õø¥µáçÕøŞÕåÖ╗Ö tab´╝îõ¢┐õ╝Ü×»ØÚçıÕÉ»ÕÉÄ×â¢µüóÕñıÒÇé
 *
 * Differs from URLViewer in exactly the three ways that justify a separate
 * component: a shared persistent partition (sign-in survives), keyword search in
 * the address bar, and writing address/title/favicon back onto the owning tab so
 * the browser can be restored after a restart.
 */
const BrowserViewer: React.FC<BrowserViewerProps> = ({ url, tabId, onUrlChange, onTitleChange, onFaviconChange }) => {
  const handleUrlChange = useCallback((next: string) => onUrlChange(tabId, next), [tabId, onUrlChange]);

  const handleTitleChange = useCallback(
    (title: string) => {
      const trimmed = title.trim();
      if (trimmed) onTitleChange(tabId, trimmed);
    },
    [tabId, onTitleChange]
  );

  const handleFaviconChange = useCallback(
    (favicon: string) => onFaviconChange(tabId, favicon),
    [tabId, onFaviconChange]
  );

  /**
   * about:blank õ©ıõ╝Ü×ğĞÕÅæ page-title-updated´╝îµëÇõ╗Ñ®║Ö¢ÚíÁÜäµáçÚóİÕ£¿×┐ÖÚçîÕà£Õ║ò´╝î
   * ÕÉĞÕêÖµû░Õ╗║ tab õ╝Üõ©Çø┤µİ¥ñ║õ©èõ©Çµ¼íÜäµáçÚóİÒÇé
   * about:blank fires no title event, so derive the label here ÔÇö otherwise a
   * fresh tab would keep showing the previous page's title.
   */
  const handleDidFinishLoad = useCallback(() => {
    if (url === BROWSER_BLANK_URL) onTitleChange(tabId, browserTabLabelFromUrl(url));
  }, [url, tabId, onTitleChange]);

  return (
    <WebviewHost
      url={url || BROWSER_BLANK_URL}
      partition={BROWSER_SESSION_PARTITION}
      showNavBar
      className='bg-bg-1'
      resolveUrlInput={resolveAddressBarInput}
      onUrlChange={handleUrlChange}
      onTitleChange={handleTitleChange}
      onFaviconChange={handleFaviconChange}
      onDidFinishLoad={handleDidFinishLoad}
    />
  );
};

export default BrowserViewer;
