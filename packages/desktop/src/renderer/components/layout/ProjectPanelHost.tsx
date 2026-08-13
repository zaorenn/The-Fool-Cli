/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Layout-level Project Panel host (stage3 FULL / P1–P4). This is the project's
 * right-side panel host: it owns the column's width, collapse, border and
 * lifecycle, and mounts a self-contained project component inside. For this round
 * the hosted component is the Explorer ({@link ExplorerContainer}); the host is
 * named generically (not `ProjectExplorerColumn`) so future project-scoped
 * components (source-control, kanban, …) can mount through the same seam without
 * re-architecting the host — no plugin framework is introduced this round.
 *
 * Seam: the host passes only `projectId` down; the component self-manages its
 * content (data, tree, actions). Host chrome (collapse chevron, drag handle) is
 * the host's concern, never the component's.
 *
 * Rendered as a sibling of the route `<Outlet>`, above the per-conversation
 * subtree, so switching conversations within the same project does NOT remount it
 * — WS subscriptions, tree and preview stay live (no teardown, no flicker).
 * Collapsing shrinks the column to width 0 (kept mounted) rather than
 * unmounting, so collapse/expand also preserves state. `data-mount-id` (once per
 * mount) is the live-test proof it is not remounted across switches or collapse.
 */

import React, { useRef, useState } from 'react';
import { Button } from '@arco-design/web-react';
import { ExpandRight } from '@icon-park/react';
import { useTranslation } from 'react-i18next';

import { ExplorerContainer } from '@/renderer/pages/conversation/explorer/ExplorerContainer';
import { useCurrentProject } from '@/renderer/pages/conversation/explorer/currentProjectStore';
import { KanbanBoard } from '@/renderer/pages/conversation/kanban/KanbanBoard';

export type ProjectPanelHostProps = {
  /** Rendered width in px (clamped by Layout against the chat+preview reserve). */
  widthPx: number;
  /** Collapsed → width 0, component kept mounted (no remount). */
  collapsed: boolean;
  /** Toggle collapse from the host chevron. */
  onToggle: () => void;
  /**
   * Whether to render the in-column collapse chevron. False on mac, where the
   * Titlebar workspace button owns the toggle (matching the legacy convention).
   */
  showChevron: boolean;
  /** Left-edge resize handle from Layout's `useResizableSplit`. */
  dragHandle?: React.ReactNode;
};

type PanelTab = 'files' | 'board';

export const ProjectPanelHost: React.FC<ProjectPanelHostProps> = ({
  widthPx,
  collapsed,
  onToggle,
  showChevron,
  dragHandle,
}) => {
  const { t } = useTranslation();
  const projectId = useCurrentProject();
  const mountIdRef = useRef<string>('');
  if (mountIdRef.current === '') mountIdRef.current = `pec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // Files by default: this is the tab every existing user already expects to
  // see, and switching tabs must not remount either side — both stay mounted,
  // the inactive one only hidden, the same way collapse never unmounts either.
  const [tab, setTab] = useState<PanelTab>('files');

  // No active project (no-project conversation / non-chat route) → no host.
  if (!projectId) return null;

  return (
    <div
      data-project-panel-host
      data-explorer-column
      data-mount-id={mountIdRef.current}
      data-collapsed={collapsed ? 'true' : 'false'}
      className='!bg-1 h-full flex-shrink-0 overflow-hidden relative flex flex-col'
      style={{
        width: collapsed ? '0px' : `${widthPx}px`,
        borderLeft: collapsed ? 'none' : '1px solid var(--bg-3)',
      }}
    >
      {!collapsed && dragHandle}
      {!collapsed && showChevron && (
        <Button
          type='text'
          className='workspace-header__toggle absolute top-8px right-8px z-30 !p-0'
          aria-label='Collapse explorer'
          onClick={onToggle}
          icon={<ExpandRight size={16} />}
        />
      )}
      {!collapsed && (
        <div className='flex items-center gap-4px px-8px pt-8px shrink-0' data-project-panel-tabs>
          <Button
            type='text'
            data-project-panel-tab='files'
            aria-pressed={tab === 'files'}
            className={`!text-12px !px-8px !py-4px !h-auto !min-h-0 rd-6px ${tab === 'files' ? '!bg-fill-3 !text-t-primary' : '!text-t-tertiary'}`}
            onClick={() => setTab('files')}
          >
            {t('kanban.filesTitle')}
          </Button>
          <Button
            type='text'
            data-project-panel-tab='board'
            aria-pressed={tab === 'board'}
            className={`!text-12px !px-8px !py-4px !h-auto !min-h-0 rd-6px ${tab === 'board' ? '!bg-fill-3 !text-t-primary' : '!text-t-tertiary'}`}
            onClick={() => setTab('board')}
          >
            {t('kanban.boardTitle')}
          </Button>
        </div>
      )}
      {/* Both stay mounted; the inactive one is only hidden, matching the
          "switching does not remount" contract this host already keeps for
          collapse. */}
      <div className='flex-1 min-h-0' style={{ display: tab === 'files' ? 'block' : 'none' }}>
        <ExplorerContainer projectId={projectId} />
      </div>
      <div className='flex-1 min-h-0' style={{ display: tab === 'board' ? 'block' : 'none' }}>
        <KanbanBoard projectId={projectId} />
      </div>
    </div>
  );
};
