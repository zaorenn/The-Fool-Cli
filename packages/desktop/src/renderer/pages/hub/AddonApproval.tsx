/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button, Modal, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { describeAddonCommand, type WorkspaceAddon } from '@/common/config/workspaceAddon';
import styles from './FoolsHub.module.css';

/**
 * What a workspace wants to install, before anything is installed.
 *
 * An addon names a command that gets run, and a workspace is a file people send
 * each other. Those two facts together are remote code execution by file share
 * unless somebody looks at the command first — so this screen is not a
 * formality, it is the whole reason importing an addon is safe at all.
 *
 * Which is why it shows the **actual command line** rather than a summary of it.
 * A person deciding whether to trust a workspace from a stranger is deciding
 * about that string; paraphrasing it would be deciding for them while appearing
 * to ask.
 *
 * Declining is a first-class outcome, not a cancel. The workspace still arrives
 * and still opens — it simply has the parts that need the addon switched off,
 * which is a better position than either installing something they did not want
 * or refusing them the workspace.
 */

export type AddonApprovalProps = {
  workspaceName: string;
  addons: readonly WorkspaceAddon[];
  onApprove: () => void;
  onDecline: () => void;
};

const AddonApproval: React.FC<AddonApprovalProps> = ({ workspaceName, addons, onApprove, onDecline }) => {
  const { t } = useTranslation();

  return (
    <Modal
      visible={addons.length > 0}
      title={t('hub.addonApproveTitle', { name: workspaceName })}
      onCancel={onDecline}
      maskClosable={false}
      footer={
        <div className='flex justify-end gap-8px'>
          <Button onClick={onDecline} data-testid='addon-decline'>
            {t('hub.addonDecline')}
          </Button>
          <Button type='primary' onClick={onApprove} data-testid='addon-approve'>
            {t('hub.addonApprove')}
          </Button>
        </div>
      }
    >
      <div className='grid gap-12px'>
        <Typography.Text className='text-13px leading-20px text-t-secondary'>
          {t('hub.addonApproveBody')}
        </Typography.Text>

        <ul className={styles.addonList} data-testid='addon-list'>
          {addons.map((addon) => (
            <li key={addon.id}>
              <span className={styles.addonName}>{addon.name}</span>
              {addon.purpose ? <span className={styles.addonPurpose}>{addon.purpose}</span> : null}
              {/* The command itself. Not a summary — this is the thing being
                  agreed to, and it has to be readable as written. */}
              <code className={styles.addonCommand}>{describeAddonCommand(addon)}</code>
            </li>
          ))}
        </ul>

        <Typography.Text className='text-11px leading-17px text-t-tertiary'>
          {t('hub.addonApproveWarning')}
        </Typography.Text>
      </div>
    </Modal>
  );
};

export default AddonApproval;
