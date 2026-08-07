/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState } from 'react';
import { Button, Input, Message, Typography } from '@arco-design/web-react';
import { Plus, Upload } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import {
  exportWorkspace,
  importWorkspace,
  normalizeWorkspaceName,
  workspaceFileName,
  type Workspace,
} from '@/common/config/workspaces';
import { useWorkspaces } from '@renderer/hooks/config/useWorkspaces';
import WorkspaceCard from './WorkspaceCard';
import styles from './FoolsHub.module.css';

/**
 * Fool's Hub: the app, aimed.
 *
 * Everything that decides what this application is for — the shape of its
 * windows, who the assistant is being, which agent and model do the work — is a
 * global setting. That is fine while there is one thing you use it for, and it
 * falls apart at two: the setup that turns a link into guitar tab is not the
 * setup you want for writing, and swapping between them by hand across five
 * settings pages is not something anybody does twice.
 *
 * So this page is where a setup becomes a thing with a name. You arrange the app
 * the way you want it, come here, and write it down; from then on it is one
 * click, or one sentence out loud. And because it is only settings, it is also a
 * file — which is what makes it something you can hand to somebody else.
 */

const FoolsHubPage: React.FC = () => {
  const { t } = useTranslation();
  const { workspaces, active, enter, save, remove, capture } = useWorkspaces();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  /**
   * Writes down the app as it is arranged right now.
   *
   * Taken from the live settings rather than from a form: the arrangement is
   * already on screen, and asking somebody to retype it would be asking them to
   * do the same work twice.
   */
  const create = async (): Promise<void> => {
    const wanted = normalizeWorkspaceName(name);
    if (wanted.length === 0) return;

    setBusy(true);
    try {
      const saved = await save(capture(name, description));
      if (saved) {
        setName('');
        setDescription('');
      }
    } finally {
      setBusy(false);
    }
  };

  /** Hands a workspace over as a file, which is the whole of sharing one. */
  const share = (workspace: Workspace): void => {
    const blob = new Blob([exportWorkspace(workspace)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = workspaceFileName(workspace);
    link.click();
    URL.revokeObjectURL(url);
  };

  /**
   * Reads one somebody sent.
   *
   * Refused loudly when it is not a workspace. A file that arrived from another
   * person and quietly rearranged the app would be the worst possible outcome
   * here — worse than an error, because nothing would say what had happened.
   */
  const receive = async (file: File): Promise<void> => {
    const result = importWorkspace(await file.text());
    if (result.ok === false) {
      Message.error(t(`hub.importError.${result.reason}`));
      return;
    }
    await save(result.workspace);
    Message.success(t('hub.imported', { name: result.workspace.name }));
  };

  return (
    <main className={styles.page} data-testid='fools-hub'>
      <header className={styles.head}>
        <Typography.Title heading={4} className='!mb-0 !text-t-primary'>
          {t('hub.title')}
        </Typography.Title>
        <Typography.Text className={styles.lede}>{t('hub.subtitle')}</Typography.Text>
      </header>

      <section className={styles.grid}>
        {workspaces.map((workspace) => (
          <WorkspaceCard
            key={workspace.id}
            workspace={workspace}
            active={workspace.id === active.id}
            onEnter={() => void enter(workspace)}
            onExport={() => share(workspace)}
            onDelete={() => void remove(workspace.id)}
          />
        ))}
      </section>

      <section className={styles.maker}>
        <div className='grid gap-4px'>
          <Typography.Text className='text-13px font-600 text-t-primary'>{t('hub.makeTitle')}</Typography.Text>
          <Typography.Text className='text-12px leading-18px text-t-tertiary'>{t('hub.makeHint')}</Typography.Text>
        </div>

        <div className={styles.makerRow}>
          <Input
            data-testid='workspace-name'
            className='max-w-240px'
            value={name}
            maxLength={48}
            placeholder={t('hub.namePlaceholder')}
            onChange={setName}
          />
          <Input
            data-testid='workspace-description'
            value={description}
            maxLength={200}
            placeholder={t('hub.descriptionPlaceholder')}
            onChange={setDescription}
          />
          <Button
            type='primary'
            icon={<Plus size={14} />}
            loading={busy}
            disabled={normalizeWorkspaceName(name).length === 0}
            onClick={() => void create()}
          >
            {t('hub.make')}
          </Button>
        </div>

        <div className={styles.makerRow}>
          <Button
            type='text'
            size='small'
            icon={<Upload size={14} />}
            data-testid='workspace-import'
            onClick={() => fileInput.current?.click()}
          >
            {t('hub.import')}
          </Button>
          <input
            ref={fileInput}
            type='file'
            accept='.json,application/json'
            className='hidden'
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void receive(file);
            }}
          />
        </div>
      </section>
    </main>
  );
};

export default FoolsHubPage;
