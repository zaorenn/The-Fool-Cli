/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The documents this assistant has fetched, and a way to open one by hand.
 *
 * Opening a found document automatically is the intended path, and it is a
 * path with two halves that fail separately: the main process saves the file,
 * the renderer shows it. The second half has been broken on its own — the tool
 * reported success, the assistant said the document was open, and no viewer
 * ever appeared — which left the user with a file they had been told about and
 * no way to reach it.
 *
 * So this reads the folder rather than the conversation. A transcript is gone
 * at the next launch and the file is not, and the moment somebody most needs
 * this list is after something did not work.
 */

import React, { useCallback, useState } from 'react';
import { Button, Dropdown, Menu, Typography } from '@arco-design/web-react';
import { FolderOpen } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { openDocument } from '@renderer/services/documents/documentViewer';
import styles from './FoundDocuments.module.css';

type FoundDocument = { path: string; name: string; bytes: number; at: number };

/** Bounded: this is a way back to something recent, not a file manager. */
const SHOWN = 12;

const readableSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const FoundDocuments: React.FC = () => {
  const { t } = useTranslation();
  const [documents, setDocuments] = useState<FoundDocument[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Read when the list is opened rather than on mount. The folder changes
  // while the conversation runs, so a list fetched once at mount would be
  // wrong exactly when a document has just arrived — which is the case this
  // exists for.
  const refresh = useCallback(async (visible: boolean): Promise<void> => {
    if (!visible) return;
    const list = window.electronAPI?.listFoundDocuments;
    if (typeof list !== 'function') {
      setLoaded(true);
      return;
    }
    const found = await list().catch((): FoundDocument[] => []);
    setDocuments(found.slice(0, SHOWN));
    setLoaded(true);
  }, []);

  const menu = (
    <Menu
      onClickMenuItem={(key) => {
        const document = documents.find((entry) => entry.path === key);
        if (document) void openDocument(document.path);
      }}
    >
      {documents.length === 0 ? (
        <Menu.Item key='__empty' disabled>
          {loaded ? t('settings.voice.conversationDocumentsEmpty') : t('settings.voice.conversationDocumentsLoading')}
        </Menu.Item>
      ) : (
        documents.map((document) => (
          <Menu.Item key={document.path}>
            <span className={styles.documentName}>{document.name}</span>
            <Typography.Text className={styles.documentSize}>{readableSize(document.bytes)}</Typography.Text>
          </Menu.Item>
        ))
      )}
    </Menu>
  );

  return (
    <Dropdown droplist={menu} trigger='click' position='br' onVisibleChange={(visible) => void refresh(visible)}>
      <Button size='mini' type='text' icon={<FolderOpen size={13} />} data-testid='voice-found-documents'>
        {t('settings.voice.conversationDocuments')}
      </Button>
    </Dropdown>
  );
};

export default FoundDocuments;
