/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button, Tag, Typography } from '@arco-design/web-react';
import { Delete, Download, PlayOne } from '@icon-park/react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import type { Workspace } from '@/common/config/workspaces';
import styles from './FoolsHub.module.css';

/**
 * One workspace, as something you can see the shape of before you switch to it.
 *
 * A list of names would be quicker to build and useless to choose from: the
 * whole point of a workspace is that it changes several things at once, so the
 * card says which ones. Someone deciding whether to switch needs to know what
 * they are switching *to* — the layout, the persona, the agent — not just what
 * it is called.
 */

export type WorkspaceCardProps = {
  workspace: Workspace;
  active: boolean;
  onEnter: () => void;
  onExport: () => void;
  onDelete: () => void;
};

const WorkspaceCard: React.FC<WorkspaceCardProps> = ({ workspace, active, onEnter, onExport, onDelete }) => {
  const { t } = useTranslation();

  const facts = [
    workspace.layouts.voice ? t('hub.factLayout', { name: workspace.layouts.voice }) : '',
    workspace.voice.personaPresetId
      ? t('hub.factPersona', {
          name: t(`settings.voice.conversationPersonaName.${workspace.voice.personaPresetId}`, {
            defaultValue: workspace.voice.personaPresetId,
          }),
        })
      : '',
    workspace.agent.modelId ? t('hub.factModel', { name: workspace.agent.modelId }) : '',
  ].filter((fact) => fact.length > 0);

  return (
    // `data-fool-target` is what a movement built in the layout editor aims at.
    // An attribute rather than a class because this file's classes are hashed by
    // CSS Modules, and a generated stylesheet lives outside the module and so
    // cannot name them.
    <article
      className={classNames(styles.card, active && styles.cardActive)}
      data-fool-target='card'
      data-testid={`workspace-${workspace.id}`}
    >
      <header className={styles.cardHead}>
        <Typography.Text className='text-15px font-600 text-t-primary'>{workspace.name}</Typography.Text>
        {active ? (
          <Tag size='small' color='green'>
            {t('hub.inUse')}
          </Tag>
        ) : workspace.builtin ? (
          <Tag size='small'>{t('hub.shipped')}</Tag>
        ) : null}
      </header>

      {/* A shipped workspace's description is the app's own words and is
          translated; a user's own is theirs and is shown exactly as written. The
          fallback is the English in the definition, so a locale that has not
          caught up shows the real sentence rather than a key. */}
      {workspace.description ? (
        <Typography.Text className={styles.cardBody}>
          {workspace.builtin
            ? t(`hub.shippedDescription.${workspace.id}`, { defaultValue: workspace.description })
            : workspace.description}
        </Typography.Text>
      ) : (
        <Typography.Text className={classNames(styles.cardBody, styles.cardBodyEmpty)}>
          {t('hub.noDescription')}
        </Typography.Text>
      )}

      <ul className={styles.facts}>
        {facts.map((fact) => (
          <li key={fact}>{fact}</li>
        ))}
      </ul>

      <footer className={styles.cardFoot}>
        <Button
          size='small'
          type={active ? 'secondary' : 'primary'}
          disabled={active}
          icon={<PlayOne size={13} />}
          onClick={onEnter}
        >
          {active ? t('hub.inUse') : t('hub.use')}
        </Button>
        <Button size='small' type='text' icon={<Download size={13} />} onClick={onExport}>
          {t('hub.share')}
        </Button>
        {/* The shipped one is the app's, not the user's: it can be copied and
            never deleted, so there is always something to fall back to. */}
        {workspace.builtin ? null : (
          <Button
            size='small'
            type='text'
            status='danger'
            icon={<Delete size={13} />}
            aria-label={t('common.delete')}
            onClick={onDelete}
          />
        )}
      </footer>
    </article>
  );
};

export default WorkspaceCard;
