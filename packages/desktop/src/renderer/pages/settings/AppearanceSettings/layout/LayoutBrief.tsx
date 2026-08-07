/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Button, Input, Message, Typography } from '@arco-design/web-react';
import { Copy, DownloadTwo } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { layoutBrief } from '@/common/config/layoutBrief';
import { readLayoutFile, type ImportedLayout } from '@/common/config/layoutImport';
import styles from './LayoutBrief.module.css';

/**
 * Having somebody else's AI design the preset.
 *
 * Two halves of one errand. The app writes out its own specification, the person
 * pastes it wherever they already talk to a model along with what they want, and
 * the answer comes back here — as a dropped file if the model gave them one, or
 * pasted if they just copied the block. Both routes, because which one a person
 * ends up with depends entirely on which tool they used, and being told to save
 * a file first is a step nobody should have to take.
 *
 * Deliberately no request from the app. It never holds a key, never picks a
 * model and never sends what somebody typed anywhere — the whole exchange
 * happens in tools the person already chose and already trusts.
 */

export type LayoutBriefProps = {
  /** Given a preset read from outside, put it in the editor for review. */
  onImported: (layout: ImportedLayout) => void;
};

const LayoutBrief: React.FC<LayoutBriefProps> = ({ onImported }) => {
  const { t } = useTranslation();
  const [over, setOver] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');

  /** Reads whatever arrived and either hands it up or says what was wrong. */
  const accept = (raw: string): void => {
    const result = readLayoutFile(raw);

    if (result.status === 'failed') {
      // Named rather than a general failure: "that was not JSON" and "that names
      // a window this app does not have" are fixed by completely different
      // actions, and only the person holding the text can do either.
      Message.error(t(`settings.layout.brief.failed.${result.reason}`));
      return;
    }

    onImported(result.layout);
    setPasted('');
    setPasting(false);
    Message.success(t('settings.layout.brief.imported', { name: result.layout.name }));
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setOver(false);

    const file = event.dataTransfer.files?.[0];
    if (file) {
      void file.text().then(accept);
      return;
    }

    // Dragged from a text editor or a chat window rather than the file system.
    const text = event.dataTransfer.getData('text/plain');
    if (text.length > 0) accept(text);
  };

  const copyBrief = async (): Promise<void> => {
    await navigator.clipboard.writeText(layoutBrief());
    Message.success(t('settings.layout.brief.copied'));
  };

  return (
    <div className='grid gap-10px'>
      <div className='grid gap-4px'>
        <Typography.Title heading={6} className='!mb-0 !text-t-primary'>
          {t('settings.layout.brief.title')}
        </Typography.Title>
        <Typography.Text className='text-12px leading-19px text-t-tertiary'>
          {t('settings.layout.brief.subtitle')}
        </Typography.Text>
      </div>

      <div className='flex flex-wrap items-center gap-8px'>
        <Button type='primary' size='small' icon={<Copy size={13} />} onClick={() => void copyBrief()}>
          {t('settings.layout.brief.copy')}
        </Button>
        <Typography.Text className='text-11px text-t-tertiary'>{t('settings.layout.brief.copyHint')}</Typography.Text>
      </div>

      <div
        className={over ? `${styles.zone} ${styles.zoneOver}` : styles.zone}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        data-testid='layout-drop-zone'
      >
        <DownloadTwo size={18} className='text-t-tertiary' />
        <Typography.Text className='text-12px text-t-secondary'>{t('settings.layout.brief.drop')}</Typography.Text>
        <Button type='text' size='mini' onClick={() => setPasting((open) => !open)}>
          {pasting ? t('common.cancel') : t('settings.layout.brief.pasteInstead')}
        </Button>
      </div>

      {/* For people whose model gave them a block to copy rather than a file. */}
      {pasting ? (
        <div className='grid gap-6px'>
          <Input.TextArea
            className={styles.paste}
            value={pasted}
            rows={5}
            placeholder={t('settings.layout.brief.pastePlaceholder')}
            onChange={setPasted}
          />
          <div>
            <Button size='small' type='primary' disabled={pasted.trim().length === 0} onClick={() => accept(pasted)}>
              {t('settings.layout.brief.use')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default LayoutBrief;
