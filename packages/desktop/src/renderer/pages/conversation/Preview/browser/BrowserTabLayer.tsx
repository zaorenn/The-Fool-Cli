/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback } from 'react';
import type { PreviewTab, PreviewTabPatch } from '../context/PreviewContext';
import BrowserViewer from './BrowserViewer';

export interface BrowserTabLayerProps {
  /** µëÇµ£ëµÁÅ×ğêÕÖ¿▒╗ÕŞïÜä tab / Every browser-type tab */
  browserTabs: PreviewTab[];
  /** Õ¢ôÕëıµ┐Çµ┤╗Üä tab id´╝êÕÅ»×â¢õ©ıµİ»µÁÅ×ğêÕÖ¿ tab´╝ë/ Active tab id (may not be a browser tab) */
  activeTabId: string | null;
  /** ÕøŞÕåÖ tab Õ¡ùµ«Á / Patch fields back onto a tab */
  updateTab: (tabId: string, patch: PreviewTabPatch) => void;
}

/**
 * Õ©©Ú®╗µîé×¢¢ÜäµÁÅ×ğêÕÖ¿Õ▒é / Always-mounted browser layer.
 *
 * Úóä×ğêÚØóµØ┐ÕÄşµ£¼ÕÅ¬µ©▓µşôÕ¢ôÕëıµ┐Çµ┤╗Üä tab´╝îÕ»╣µûçµíúµ▓íÚù«Úóİ´╝îõ¢åÕ»╣µÁÅ×ğêÕÖ¿µİ»×ç┤Õæ¢Üä´╝Ü
 * Õêç×Á░ÕåıÕêçÕøŞõ╝ÜÚçıµû░Õèá×¢¢ÚíÁÚØó´╝îµ╗ÜÕè¿õ¢ı¢«ÒÇü×í¿ÕıòÕåàÕ«╣ÒÇüµ£¬µÅÉõ║ñÜäµôıõ¢£Õà¿Úâ¿õ©óÕñ▒´╝î
 * Agent µ¡úÕ£¿×┐ø×íîÜäµôıõ¢£õ╣şõ╝Ü×ó½µëôµû¡ÒÇé
 *
 * µëÇõ╗Ñ×┐Öõ©ÇÕ▒éµèèµëÇµ£ëµÁÅ×ğêÕÖ¿ tab õ©Çø┤µîéØÇ´╝îÕÅ¬ÕêçµıóÕÅ»×ğüµÇğ ÔÇöÔÇö webview ×┐ø¿ïõ©ıÚöÇµ»ü´╝î
 * ÚíÁÚØóèÂµÇüÕ«îµò┤õ┐ØòÖÒÇéÚØŞµ┐Çµ┤╗Üä tab ö¿ visibility ÚÜÉ×ùÅ×Çîõ©ıµİ» display:none´╝î
 * ×┐ÖµáÀÕ«âõ╗¼õ╗ıµ£ë£şÕ«ŞÕ░║Õ»©´╝îÕêçÕøŞµØÑµùÂõ©ıÚ£Ç×ĞüÚçıµû░Õ©âÕ▒ÇÒÇé
 *
 * The preview panel renders only the active tab, which is fine for documents but
 * fatal for a browser: switching away and back would reload the page, losing
 * scroll position, form input, and any in-flight agent operation. This layer keeps
 * every browser tab mounted and only toggles visibility, so the webview process
 * survives. Inactive tabs are hidden via `visibility` rather than `display:none`
 * so they retain real dimensions and need no relayout when shown again.
 */
const BrowserTabLayer: React.FC<BrowserTabLayerProps> = ({ browserTabs, activeTabId, updateTab }) => {
  const handleUrlChange = useCallback(
    (tabId: string, url: string) => {
      // Õ£░ÕØÇÕ¡İÕ£¿ content Úçî´╝îõ©ÄÕàÂõ╗û tab ▒╗ÕŞïõ┐Øµîüõ©Ç×ç┤ / Address lives in content, like other tab types
      updateTab(tabId, { content: url });
    },
    [updateTab]
  );

  const handleTitleChange = useCallback((tabId: string, title: string) => updateTab(tabId, { title }), [updateTab]);

  const handleFaviconChange = useCallback(
    (tabId: string, favicon: string) => updateTab(tabId, { metadata: { favicon } }),
    [updateTab]
  );

  if (browserTabs.length === 0) return null;

  const isBrowserActive = browserTabs.some((tab) => tab.id === activeTabId);

  return (
    <div className='relative flex-1 overflow-hidden' style={{ display: isBrowserActive ? undefined : 'none' }}>
      {browserTabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className='absolute inset-0 flex flex-col'
            style={{
              visibility: isActive ? 'visible' : 'hidden',
              pointerEvents: isActive ? undefined : 'none',
              zIndex: isActive ? 1 : 0,
            }}
          >
            <BrowserViewer
              url={tab.content}
              tabId={tab.id}
              onUrlChange={handleUrlChange}
              onTitleChange={handleTitleChange}
              onFaviconChange={handleFaviconChange}
            />
          </div>
        );
      })}
    </div>
  );
};

export default BrowserTabLayer;
