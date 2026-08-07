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
import type { WorkspaceAddon } from '@/common/config/workspaceAddon';
import AddonApproval from './AddonApproval';
import { fetchMissingSkills, missingSkills } from './fetchMissingSkills';
import { installAddons, missingAddons } from './installAddons';
import WorkspaceAppPanel from './WorkspaceAppPanel';
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
  /** Skills being fetched for a workspace that has just arrived. */
  const [fetching, setFetching] = useState<string[]>([]);
  /**
   * What an arriving workspace wants to install, waiting on the user.
   *
   * Held rather than installed: an addon names a command that gets run, and this
   * file came from another person. Nothing happens until they have seen it.
   */
  const [pending, setPending] = useState<{ workspace: Workspace; addons: WorkspaceAddon[] } | null>(null);
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

  /**
   * Hands a workspace over as a file, with its page inside it.
   *
   * The app's files travel in the same file rather than being fetched
   * afterwards: a workspace that arrives and then cannot find its own page does
   * not work, and the person who received it has nothing to go and get.
   */
  const share = async (workspace: Workspace): Promise<void> => {
    const files = workspace.app ? ((await window.electronAPI?.readWorkspaceApp?.(workspace.app.folder)) ?? {}) : {};

    const blob = new Blob([exportWorkspace(workspace, files)], { type: 'application/json' });
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

    // The page goes to disk before the workspace claims to have one. The other
    // order gives the user a workspace that switches to an empty panel, which
    // looks like the app being broken rather than like an import that failed.
    const app = result.workspace.app;
    if (app) {
      const written = (await window.electronAPI?.writeWorkspaceApp?.(app.folder, result.files)) ?? 0;
      if (written === 0) {
        Message.error(t('hub.importError.no-app'));
        return;
      }
    }

    await save(result.workspace);
    Message.success(t('hub.imported', { name: result.workspace.name }));

    // The second half of an import. A workspace carries its own page, so nothing
    // about the app can arrive incomplete — but the skills its page calls live
    // in the library rather than in the file, and without this it opens, looks
    // correct, and fails the first time somebody presses the button.
    // Addons first, and only with permission. They run a command; the skills
    // below do not, which is why only one of these two asks.
    const wanted = await missingAddons(result.workspace);
    if (wanted.length > 0) setPending({ workspace: result.workspace, addons: wanted });

    const missing = await missingSkills(result.workspace);
    if (missing.length === 0) return;

    setFetching(missing);
    try {
      const fetched = await fetchMissingSkills(result.workspace, missing);
      if (fetched.ok === false || fetched.installed.length < missing.length) {
        const left = fetched.ok ? missing.filter((skill) => !fetched.installed.includes(skill)) : missing;
        Message.warning(t('hub.skillsMissing', { names: left.join(', ') }));
        return;
      }
      Message.success(t('hub.skillsInstalled', { names: fetched.installed.join(', ') }));
    } finally {
      setFetching([]);
    }
  };

  return (
    <main className={styles.page} data-testid='fools-hub'>
      <header className={styles.head}>
        <Typography.Title heading={4} className='!mb-0 !text-t-primary'>
          {t('hub.title')}
        </Typography.Title>
        <Typography.Text className={styles.lede}>{t('hub.subtitle')}</Typography.Text>
      </header>

      {/* The workspace's own page, when it has one. Above the list rather than
          below it: this is the thing the user came to use, and the list is how
          they got here. */}
      {active.app ? <WorkspaceAppPanel app={active.app} workspaceId={active.id} addons={active.addons} /> : null}

      <section className={styles.grid}>
        {workspaces.map((workspace) => (
          <WorkspaceCard
            key={workspace.id}
            workspace={workspace}
            active={workspace.id === active.id}
            onEnter={() => void enter(workspace)}
            onExport={() => void share(workspace)}
            onDelete={() => void remove(workspace.id)}
          />
        ))}
      </section>

      {pending ? (
        <AddonApproval
          workspaceName={pending.workspace.name}
          addons={pending.addons}
          onApprove={() => {
            const approving = pending;
            setPending(null);
            void installAddons(approving.addons).then((installed) => {
              const failed = approving.addons.filter((addon) => !installed.includes(addon.id));
              if (failed.length > 0) {
                Message.warning(t('hub.addonFailed', { names: failed.map((addon) => addon.name).join(', ') }));
                return;
              }
              Message.success(t('hub.addonInstalled', { names: approving.addons.map((a) => a.name).join(', ') }));
            });
          }}
          onDecline={() => {
            // Declining is an outcome, not a cancel: the workspace still opens,
            // with the parts that need the addon switched off.
            Message.info(t('hub.addonDeclined'));
            setPending(null);
          }}
        />
      ) : null}

      {fetching.length > 0 ? (
        <div className={styles.fetching} data-testid='workspace-fetching'>
          <Typography.Text className='text-12px text-t-secondary'>
            {t('hub.skillsFetching', { names: fetching.join(', ') })}
          </Typography.Text>
        </div>
      ) : null}

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
