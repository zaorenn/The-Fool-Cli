/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Message, Typography } from '@arco-design/web-react';
import { Undo } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import {
  peekMemoryVersions,
  subscribeVoiceMemory,
  undoLastMemoryChange,
} from '@renderer/services/voice/session/voiceMemoryStore';

/**
 * Putting the memory back to how it was a moment ago.
 *
 * Every write to the memory has kept the version before it for a while, and
 * nothing in the application offered them — the undo existed as a tested module
 * with no way in. This is the way in, and it is deliberately one button rather
 * than a version browser: the thing people want from this is almost always the
 * same thing, said in the same breath as noticing it. *No, I did not say that.*
 *
 * Absent when there is nothing to go back to, which is the state a fresh
 * install is in, rather than shown greyed out. A control that cannot do
 * anything is a question the user has to answer every time they read the page.
 */
const UndoLastChange: React.FC = () => {
  const { t } = useTranslation();
  const [available, setAvailable] = useState(() => peekMemoryVersions().length > 0);
  const [working, setWorking] = useState(false);

  // The assistant writes to this while the page is open — a conversation in the
  // background learning something is exactly when an undo becomes worth
  // offering, so the button has to appear without the page being reopened.
  useEffect(() => subscribeVoiceMemory(() => setAvailable(peekMemoryVersions().length > 0)), []);

  const undo = useCallback(async (): Promise<void> => {
    setWorking(true);
    try {
      const restored = await undoLastMemoryChange();
      if (restored) Message.success(t('settings.memory.undone'));
      else Message.info(t('settings.memory.nothingToUndo'));
    } catch {
      Message.error(t('settings.memory.undoFailed'));
    } finally {
      setWorking(false);
      setAvailable(peekMemoryVersions().length > 0);
    }
  }, [t]);

  if (!available) return null;

  return (
    <div className='flex items-center justify-between gap-12px rounded-8px bg-2 px-12px py-8px'>
      <Typography.Text className='text-12px leading-19px text-t-tertiary'>
        {t('settings.memory.undoHint')}
      </Typography.Text>
      <Button
        size='mini'
        icon={<Undo theme='outline' size='14' />}
        loading={working}
        onClick={() => void undo()}
        data-testid='memory-undo'
      >
        {t('settings.memory.undo')}
      </Button>
    </div>
  );
};

export default UndoLastChange;
