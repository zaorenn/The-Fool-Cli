/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * µÁÅ×ğêÕÖ¿ tab Õ£¿ PreviewContext õ©¡Üä×íîõ©║µÁï×»òÒÇé
 *
 * ×┐ÖÚçî×ĞåøûÜäÚâ¢µİ»"ÚöÖõ║åõ╝ÜÕ¥êÚÜ¥µşÑ"ÜäÚÇ╗×¥æ´╝Ütab õ©èÚÖÉ×ğĞÕÅæµùÂÜäÕñıö¿ÒÇü®║Ö¢ÚíÁõ©ı×ó½×»»ÕÉêÕ╣ÂÒÇü
 * ÕÉÄÕÅ░ tab ×â¢×ó½µø┤µû░ÒÇüõ╗ÑÕÅèµîüõ╣àÕîûµùÂµ┤╗Õè¿×ğÆµáçÕ┐àÚí╗×ó½Úçı¢«ÒÇé
 *
 * Covers the PreviewContext behaviors whose failures are hard to diagnose: tab-cap
 * reuse, blank tabs not merging into each other, background tabs being patchable,
 * and the activity badge never being restored as active.
 */

import React from 'react';
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/common', () => ({
  ipcBridge: {
    fileStream: { contentUpdate: { on: () => () => {} } },
    preview: { open: { on: () => () => {} } },
    conversation: { responseStream: { on: () => () => {} } },
    fs: { getFileContent: { invoke: vi.fn() }, writeFile: { invoke: vi.fn() } },
  },
}));

vi.mock('@/renderer/pages/conversation/Preview/browser/firstUseNotice', () => ({
  maybeNotifyFirstAgentBrowserUse: vi.fn(),
}));

import {
  PreviewProvider,
  usePreviewContext,
  type PreviewContextValue,
} from '@/renderer/pages/conversation/Preview/context/PreviewContext';
import { MAX_BROWSER_TABS } from '@/renderer/pages/conversation/Preview/browser/constants';

let ctx: PreviewContextValue;

const Probe: React.FC = () => {
  ctx = usePreviewContext();
  return null;
};

const renderProvider = () =>
  render(
    <PreviewProvider>
      <Probe />
    </PreviewProvider>
  );

const browserTabs = () => ctx.tabs.filter((tab) => tab.content_type === 'browser');

beforeEach(() => {
  localStorage.clear();
});

describe('PreviewContext browser tabs', () => {
  it('opens a blank browser tab with the placeholder title', () => {
    renderProvider();
    act(() => ctx.openBrowserTab());

    expect(browserTabs()).toHaveLength(1);
    expect(browserTabs()[0].content).toBe('about:blank');
    expect(browserTabs()[0].title).toBe('New Tab');
    expect(ctx.isOpen).toBe(true);
  });

  it('opens a browser tab at a given address', () => {
    renderProvider();
    act(() => ctx.openBrowserTab('https://example.com'));

    expect(browserTabs()[0].content).toBe('https://example.com');
  });

  it('stacks multiple blank browser tabs instead of merging them', () => {
    // Õà│Úö«×íîõ©║´╝Üõ©ñõ©¬µû░Õ╗║ tab ÕåàÕ«╣ÕÆîµáçÚóİÚâ¢ø©ÕÉî´╝îµÖ«ÚÇÜÕÄ╗ÚçıÚÇ╗×¥æõ╝ÜµèèÕ«âõ╗¼ÕÉêµêÉõ©Çõ©¬´╝î
    // ö¿µêÀé╣õ©ñµ¼íÕèáÕÅÀÕÅ¬õ╝Ü£ïÕê░õ©Çõ©¬ tabÒÇé
    // Key behavior: two fresh tabs share content and title, so the normal dedupe
    // path would fold them into one and two plus-clicks would yield one tab.
    renderProvider();
    act(() => ctx.openBrowserTab());
    act(() => ctx.openBrowserTab());

    expect(browserTabs()).toHaveLength(2);
  });

  it('stacks tabs pointing at the same address', () => {
    renderProvider();
    act(() => ctx.openBrowserTab('https://example.com'));
    act(() => ctx.openBrowserTab('https://example.com'));

    expect(browserTabs()).toHaveLength(2);
  });

  it('caps the number of browser tabs and reuses the oldest one', () => {
    renderProvider();
    for (let i = 0; i < MAX_BROWSER_TABS; i += 1) {
      act(() => ctx.openBrowserTab(`https://example.com/${i}`));
    }
    expect(browserTabs()).toHaveLength(MAX_BROWSER_TABS);
    const oldestId = browserTabs()[0].id;

    act(() => ctx.openBrowserTab('https://overflow.example.com'));

    expect(browserTabs()).toHaveLength(MAX_BROWSER_TABS);
    // µ£ÇµùğÜä tab ×ó½Õ»╝×ê¬Õê░µû░Õ£░ÕØÇ´╝î×Çîõ©ıµİ»µû░ÕóŞõ©Çõ©¬
    // The oldest tab is navigated to the new address rather than a tab being added.
    expect(browserTabs()[0].id).toBe(oldestId);
    expect(browserTabs()[0].content).toBe('https://overflow.example.com');
    expect(ctx.activeTabId).toBe(oldestId);
  });

  it('surfaces a signal when the cap is hit so the UI can explain the reuse', () => {
    renderProvider();
    expect(ctx.browserTabLimitHitAt).toBeNull();

    for (let i = 0; i < MAX_BROWSER_TABS + 1; i += 1) {
      act(() => ctx.openBrowserTab(`https://example.com/${i}`));
    }

    expect(ctx.browserTabLimitHitAt).toBeTypeOf('number');
  });

  it('does not hit the cap while below the limit', () => {
    renderProvider();
    for (let i = 0; i < MAX_BROWSER_TABS; i += 1) {
      act(() => ctx.openBrowserTab(`https://example.com/${i}`));
    }
    expect(ctx.browserTabLimitHitAt).toBeNull();
  });
});

describe('PreviewContext browser tab persistence', () => {
  const readScope = (scope: string) => JSON.parse(localStorage.getItem(`preview-ui:${scope}`) ?? '{}');

  it('persists browser tabs per project so switching projects restores the right pages', async () => {
    renderProvider();
    act(() => ctx.closePreviewIfScopeChanged('project-a'));
    act(() => ctx.openBrowserTab('https://example.com'));

    // ÕêçµıóÕê░ÕÅĞõ©Çõ©¬Úí╣ø«µùÂ´╝îÕ¢ôÕëıÚí╣ø«ÜäèÂµÇü×ó½ÕåÖÕàÑ´╝øµÁÅ×ğêÕÖ¿ tab Õ▒Şõ║ÄÚí╣ø«×ÇîÚØŞõ╝Ü×»Ø
    // Switching to another project persists the current one. Browser tabs belong to
    // the project, not the conversation.
    act(() => ctx.closePreviewIfScopeChanged('project-b'));

    const stored = readScope('project-a');
    expect(stored.tabs).toHaveLength(1);
    expect(stored.tabs[0].content).toBe('https://example.com');
    expect(stored.tabs[0].content_type).toBe('browser');

    // project-b µİ»µû░Úí╣ø«´╝îõ©ı×»Ñ£ïÕê░ project-a Üä tab
    // project-b is a different project and must not see project-a's tabs.
    expect(browserTabs()).toHaveLength(0);

    // ÕêçÕøŞµØÑÕÉÄµüóÕñı / Returning restores them
    act(() => ctx.closePreviewIfScopeChanged('project-a'));
    expect(browserTabs()).toHaveLength(1);
    expect(browserTabs()[0].content).toBe('https://example.com');
  });

  it('never restores the agent activity badge as active', () => {
    // Õà│Úö«×íîõ©║´╝Ü×ğÆµáçµİ»"µ¡ñÕê╗ Agent µ¡úÕ£¿µôıõ¢£"ÜäÕ«ŞµùÂõ┐íÕÅÀÒÇé×ïÑ×ó½µîüõ╣àÕîûµêÉ true´╝î
    // ÚçıÕÉ»ÕÉÄõ╝Üµ░©õ╣àõ║«ØÇ´╝îö¿µêÀõ╝Üõ╗Ñõ©║ Agent Õ£¿ÕüÀÕüÀµôıõ¢£µÁÅ×ğêÕÖ¿ÒÇé
    // Key behavior: the badge means "the agent is acting right now". Persisted as
    // true it would stay lit forever after a restart, making the user think the
    // agent is secretly driving the browser.
    renderProvider();
    act(() => ctx.closePreviewIfScopeChanged('project-a'));
    act(() => ctx.openBrowserTab('https://example.com'));
    const tabId = browserTabs()[0].id;
    act(() => ctx.updateTab(tabId, { metadata: { agentActive: true } }));
    expect(browserTabs()[0].metadata?.agentActive).toBe(true);

    act(() => ctx.closePreviewIfScopeChanged('project-b'));

    const stored = readScope('project-a');
    expect(stored.tabs[0].metadata.agentActive).toBe(false);

    act(() => ctx.closePreviewIfScopeChanged('project-a'));
    expect(browserTabs()[0].metadata?.agentActive).toBe(false);
  });

  it('persists the favicon so restored tabs keep their site icon', () => {
    renderProvider();
    act(() => ctx.closePreviewIfScopeChanged('project-a'));
    act(() => ctx.openBrowserTab('https://example.com'));
    act(() => ctx.updateTab(browserTabs()[0].id, { metadata: { favicon: 'https://example.com/favicon.ico' } }));

    act(() => ctx.closePreviewIfScopeChanged('project-b'));
    act(() => ctx.closePreviewIfScopeChanged('project-a'));

    expect(browserTabs()[0].metadata?.favicon).toBe('https://example.com/favicon.ico');
  });
});

describe('PreviewContext focus on open', () => {
  /**
   * ÕøŞÕ¢ÆµÁï×»ò´╝ÜopenPreview µø¥µèèÒÇî×»Ñµ┐Çµ┤╗Õô¬õ©¬ tabÒÇıÜä×ÁïÕÇ╝ÕåÖÕ£¿ setTabs Üä updater Úçî´╝î
   * ×Çî React ÕÅ¬Õ£¿ fiber µ▓íµ£ëÕ¥àÕñäÉåµø┤µû░µùÂµëıµÇÑÕêçµ▒éÕÇ╝ updater ÔÇöÔÇö õ║Äµİ»¼¼õ©Çµ¼íµëôÕ╝Çµ¡úÕ©©´╝î
   * ¼¼õ║îµ¼íõ╣ïÕÉÄµëôÕ╝ÇÜä tab õ©ıõ╝Ü×ó½µ┐Çµ┤╗ÒÇé×┐Öõ©¬ bug Õ¢▒ÕôıµëÇµ£ë tab ▒╗ÕŞï´╝îõ©ıÕÅ¬µİ»µÁÅ×ğêÕÖ¿ÒÇé
   *
   * Regression: openPreview used to decide the next active tab inside the setTabs
   * updater, but React only eagerly evaluates an updater while the fiber has no
   * pending update ÔÇö so the first open focused correctly and every later one did
   * not. The bug affected every tab type, not just the browser.
   */
  it('focuses each newly opened tab, not only the first', () => {
    renderProvider();
    act(() => ctx.openPreview('a', 'code', { file_name: 'a.ts' }));
    const firstId = ctx.tabs[0].id;
    expect(ctx.activeTabId).toBe(firstId);

    act(() => ctx.openPreview('b', 'code', { file_name: 'b.ts' }));
    expect(ctx.tabs).toHaveLength(2);
    expect(ctx.activeTabId).toBe(ctx.tabs[1].id);

    act(() => ctx.openPreview('c', 'code', { file_name: 'c.ts' }));
    expect(ctx.tabs).toHaveLength(3);
    expect(ctx.activeTabId).toBe(ctx.tabs[2].id);
  });

  it('focuses each newly opened browser tab', () => {
    renderProvider();
    act(() => ctx.openBrowserTab('https://first.example.com'));
    act(() => ctx.openBrowserTab('https://second.example.com'));

    expect(ctx.activeTabId).toBe(browserTabs()[1].id);
  });

  // Dedup keys on ChatFileRef identity. A file name is not identity ÔÇö matching on it
  // merged same-named files from different directories into one tab, where they
  // overwrote each other. Two ref-less tabs therefore stay separate.
  it('re-focuses the existing tab when the same file is opened again', () => {
    const fileRef = { kind: 'project' as const, pe_id: 'peA', relative_path: 'src/a.ts' };
    const otherRef = { kind: 'project' as const, pe_id: 'peA', relative_path: 'src/b.ts' };
    renderProvider();
    act(() => ctx.openPreview('a', 'code', { file_name: 'a.ts', fileRef }));
    const firstId = ctx.tabs[0].id;
    act(() => ctx.openPreview('b', 'code', { file_name: 'b.ts', fileRef: otherRef }));
    expect(ctx.activeTabId).not.toBe(firstId);

    act(() => ctx.openPreview('a', 'code', { file_name: 'a.ts', fileRef }));

    expect(ctx.tabs).toHaveLength(2);
    expect(ctx.activeTabId).toBe(firstId);
  });

  it('keeps ref-less tabs separate rather than merging them by name', () => {
    renderProvider();
    act(() => ctx.openPreview('a', 'code', { file_name: 'a.ts' }));
    act(() => ctx.openPreview('a', 'code', { file_name: 'a.ts' }));

    // No identity to compare, so no dedup: an extra tab is the safe outcome, while
    // a wrong merge would let two files overwrite each other.
    expect(ctx.tabs).toHaveLength(2);
  });

  /**
   * `replace` ø«Õëıµ▓íµ£ë×░âö¿µû╣´╝ê#3821 µèèµûçõ╗ÂµáæÜä `{ replace: true }` ÕÄ╗µÄëõ║å´╝îµö╣µêÉ×┐¢Õèá
   * µû░ tab´╝ëÒÇéõ¢å openPreview õ╗ıµö»µîüÕ«â´╝îµëÇõ╗Ñ×┐ÖÚçîÚöüõ¢Å×íîõ©║´╝îÚü┐ÕàıÕ░åµØÑÚçıµŞäµùÂ×ó½ÚØÖÚ╗İµö╣ÕØÅ
   * µêû×»»ÕêáÔÇöÔÇö×»¡õ╣ëµİ»"Õñıö¿Õ¢ôÕëı tab"´╝îõ©öÕ¢ôÕëı tab µ£ëµ£¬õ┐ØÕ¡İõ┐«µö╣µùÂÕ┐àÚí╗×«®õ¢ıÒÇüÕÅĞÕ╝Çµû░ tabÒÇé
   *
   * `replace` currently has no caller (#3821 dropped `{ replace: true }` from the
   * explorer in favor of appending). openPreview still supports it, so pin the
   * behavior against silent breakage in future refactors: reuse the active tab, but
   * fall back to a new tab when the active one has unsaved edits.
   */
  it('reuses the active tab when replace is requested', () => {
    renderProvider();
    act(() => ctx.openPreview('a', 'code', { file_name: 'a.ts' }));
    const firstId = ctx.tabs[0].id;

    act(() => ctx.openPreview('b', 'code', { file_name: 'b.ts' }, { replace: true }));

    expect(ctx.tabs).toHaveLength(1);
    expect(ctx.tabs[0].id).toBe(firstId);
    expect(ctx.tabs[0].content).toBe('b');
    expect(ctx.activeTabId).toBe(firstId);
  });

  it('opens a new tab instead of replacing when the active tab has unsaved edits', () => {
    renderProvider();
    act(() => ctx.openPreview('a', 'code', { file_name: 'a.ts' }));
    act(() => ctx.updateContent('a edited'));
    expect(ctx.tabs[0].isDirty).toBe(true);

    act(() => ctx.openPreview('b', 'code', { file_name: 'b.ts' }, { replace: true }));

    // µ£¬õ┐ØÕ¡İÜäõ┐«µö╣õ©ı×â¢×ó½×ĞåøûµÄë / Unsaved edits must not be discarded
    expect(ctx.tabs).toHaveLength(2);
    expect(ctx.tabs[0].content).toBe('a edited');
  });
});

describe('PreviewContext updateTab', () => {
  it('patches title, address and metadata of a specific tab', () => {
    renderProvider();
    act(() => ctx.openBrowserTab());
    const tabId = browserTabs()[0].id;

    act(() =>
      ctx.updateTab(tabId, {
        title: 'Example Domain',
        content: 'https://example.com',
        metadata: { favicon: 'https://example.com/favicon.ico' },
      })
    );

    const tab = browserTabs()[0];
    expect(tab.title).toBe('Example Domain');
    expect(tab.content).toBe('https://example.com');
    expect(tab.metadata?.favicon).toBe('https://example.com/favicon.ico');
  });

  it('updates a background tab without stealing focus', () => {
    // Õà│Úö«×íîõ©║´╝ÜÕÉÄÕÅ░ tab ÜäÚíÁÚØóµáçÚóİõ╣şõ╝ÜÕÅİÕîû´╝îµø┤µû░Õ«âõ©ı×â¢µèèö¿µêÀµï¢Õê░Úéúõ©¬ tab õ©è
    // Key behavior: a background tab's page title still changes, and updating it
    // must not drag the user over to that tab.
    renderProvider();
    act(() => ctx.openBrowserTab('https://first.example.com'));
    const firstId = browserTabs()[0].id;
    act(() => ctx.openBrowserTab('https://second.example.com'));
    const secondId = browserTabs()[1].id;

    act(() => ctx.updateTab(firstId, { title: 'First' }));

    expect(ctx.activeTabId).toBe(secondId);
    expect(browserTabs()[0].title).toBe('First');
  });

  it('merges metadata instead of replacing it', () => {
    renderProvider();
    act(() => ctx.openBrowserTab());
    const tabId = browserTabs()[0].id;

    act(() => ctx.updateTab(tabId, { metadata: { favicon: 'a.ico' } }));
    act(() => ctx.updateTab(tabId, { metadata: { agentActive: true } }));

    expect(browserTabs()[0].metadata?.favicon).toBe('a.ico');
    expect(browserTabs()[0].metadata?.agentActive).toBe(true);
  });

  it('ignores an empty title so a blank page cannot erase a good one', () => {
    renderProvider();
    act(() => ctx.openBrowserTab());
    const tabId = browserTabs()[0].id;
    act(() => ctx.updateTab(tabId, { title: 'Real Title' }));

    act(() => ctx.updateTab(tabId, { title: '' }));

    expect(browserTabs()[0].title).toBe('Real Title');
  });

  it('is a no-op for an unknown tab id and for an empty id', () => {
    renderProvider();
    act(() => ctx.openBrowserTab());
    const before = browserTabs()[0];

    act(() => ctx.updateTab('does-not-exist', { title: 'Nope' }));
    act(() => ctx.updateTab('', { title: 'Nope' }));

    expect(browserTabs()[0]).toEqual(before);
  });

  it('allows clearing the address to an empty string', () => {
    // content ö¿ typeof µúÇµşÑ×ÇîÚØŞ£şÕÇ╝µúÇµşÑ´╝î®║Õ¡ù¼Ğõ©▓µİ»ÕÉêµ│òÜäµ©à®║µôıõ¢£
    // content is checked with typeof rather than truthiness, so clearing is valid.
    renderProvider();
    act(() => ctx.openBrowserTab('https://example.com'));
    const tabId = browserTabs()[0].id;

    act(() => ctx.updateTab(tabId, { content: '' }));

    expect(browserTabs()[0].content).toBe('');
  });
});
