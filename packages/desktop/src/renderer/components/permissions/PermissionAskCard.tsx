/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Modal, Typography } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OutstandingAsk } from '@/common/permissions/pendingAsks';
import { answerAlways, answerAsk, subscribeToAsks } from '@renderer/services/permissions/permissionStore';

/**
 * The question, when the rules do not answer it.
 *
 * Mounted once at the root rather than per page, because the thing that needs an
 * answer is a tool call and a tool call does not belong to a page: a spoken
 * conversation can ask this with the window minimised and the chat closed.
 *
 * One at a time, oldest first. Two cards at once is how a user ends up
 * approving the second while reading the first.
 */
export const PermissionAskCard: React.FC = () => {
  const { t } = useTranslation();
  const [outstanding, setOutstanding] = useState<readonly OutstandingAsk[]>([]);

  useEffect(() => subscribeToAsks(setOutstanding), []);

  const ask = outstanding[0];
  if (ask === undefined) return null;

  // What is actually about to happen, in the user's own terms. The command or
  // the path rather than the tool's internal name: "Bash" tells them nothing,
  // and `rm -rf D:/work` tells them everything.
  const target = ask.call.command ?? ask.call.path ?? '';

  return (
    <Modal
      visible
      title={t('permissions.askTitle')}
      onCancel={() => answerAsk(ask.id, 'deny')}
      maskClosable={false}
      footer={
        <div className='flex justify-end gap-8px'>
          <Button onClick={() => answerAsk(ask.id, 'deny')}>{t('permissions.deny')}</Button>
          {ask.always ? <Button onClick={() => void answerAlways(ask.id)}>{t('permissions.always')}</Button> : null}
          <Button type='primary' onClick={() => answerAsk(ask.id, 'allow')}>
            {t('permissions.allow')}
          </Button>
        </div>
      }
    >
      <Typography.Paragraph>{t('permissions.askBody', { tool: ask.call.tool })}</Typography.Paragraph>
      {target.length > 0 ? (
        <Typography.Text code className='break-all'>
          {target}
        </Typography.Text>
      ) : null}
      {ask.always ? null : (
        <Typography.Paragraph type='secondary' className='mt-8px mb-0'>
          {t('permissions.noAlwaysForSending')}
        </Typography.Paragraph>
      )}
    </Modal>
  );
};
