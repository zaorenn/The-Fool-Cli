import React from 'react';
import type { ScmRepository, ScmStatus, ScmResource, ScmActionKind } from './scmModel';
import type { ScmActionReport } from './useScmActions';
import type { ScmViewMode } from './scmUiStore';

export const discardAllTargets = (status: ScmStatus | undefined, staging: boolean): ScmResource[] => {
  return [];
};

export const stageAllTargets = (status: ScmStatus | undefined, staging: boolean): ScmResource[] => {
  return [];
};

export interface ScmChangesViewProps {
  repo: ScmRepository;
  status?: ScmStatus;
  selectedKey: string | null;
  onAction: (action: ScmActionKind, repoId: string, resources: ScmResource[]) => void;
  busy: boolean;
  failedRowKeys: string[];
  viewMode: ScmViewMode;
  treeExpanded: readonly string[];
}

export const ScmChangesView: React.FC<ScmChangesViewProps> = (props) => {
  return <div>ScmChangesView Mock</div>;
};
