/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { Button, Input, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';

/**
 * One memory file, shown as what it is.
 *
 * The point of this control is that there is nothing between the user and the
 * document: no list of remembered items with delete buttons, no form. They see
 * the markdown the assistant reads and they can rewrite any of it, which is the
 * only way "remember that I moved" is a thing a person can do without saying it
 * out loud and hoping.
 *
 * Two behaviours it needs and a plain textarea does not. The document changes
 * underneath it while a conversation runs, so an untouched editor follows along
 * — watching your name appear as you say it is worth more than any explanation
 * of what this page does. And a touched one does not: a save arriving while
 * someone is halfway through a sentence would take the sentence away.
 */

type MemoryDocEditorProps = {
  /** What is stored right now, which may change while this is on screen. */
  value: string;
  label: string;
  hint: string;
  onSave: (text: string) => Promise<unknown>;
  'data-testid'?: string;
};

const MemoryDocEditor: React.FC<MemoryDocEditorProps> = ({ value, label, hint, onSave, ...rest }) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  // The stored text this draft was taken from, which is not always the current
  // one: a conversation can write to the document while it is being edited.
  const [base, setBase] = useState(value);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const dirty = draft !== base;

  // Read during the effect below, where what matters is whether there was work
  // in progress *before* the incoming version arrived.
  const wasDirty = useRef(dirty);
  wasDirty.current = dirty;

  /**
   * That the version about to arrive is this editor's own save coming back.
   *
   * The store tidies what it is given — a trailing newline, a document trimmed
   * to length — so the text that lands is rarely byte-identical to the text that
   * was typed. Without this the editor would still read "unsaved changes"
   * immediately after a successful save, which is the one moment it must not.
   */
  const justSaved = useRef(false);

  useEffect(() => {
    setBase(value);
    // An untouched editor follows the document, so a name learned out loud
    // appears here as it is said. A touched one keeps what is being typed —
    // taking someone's half-written sentence away is worse than being a moment
    // out of date, and Revert puts the incoming version back within one click.
    if (!wasDirty.current || justSaved.current) setDraft(value);
    justSaved.current = false;
  }, [value]);

  // Reported here rather than in a toast. A toast that a memory failed to save
  // is gone in three seconds and the editor still shows the text as if it had
  // been kept, which is exactly the wrong impression to leave about a memory.
  const save = async (): Promise<void> => {
    setSaving(true);
    setFailed(false);
    justSaved.current = true;
    try {
      await onSave(draft);
    } catch {
      justSaved.current = false;
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='grid gap-8px'>
      <div className='flex items-baseline justify-between gap-10px'>
        <Typography.Text className='font-600 text-t-primary'>{label}</Typography.Text>
        <Typography.Text className='text-11px text-t-tertiary'>
          {dirty ? t('settings.memory.unsaved') : t('settings.memory.upToDate')}
        </Typography.Text>
      </div>

      <Typography.Text className='text-11px leading-17px text-t-tertiary'>{hint}</Typography.Text>

      <Input.TextArea
        {...rest}
        value={draft}
        onChange={setDraft}
        autoSize={{ minRows: 10, maxRows: 18 }}
        placeholder={t('settings.memory.placeholder')}
        className='!font-mono !text-12px !leading-19px'
      />

      <div className='flex items-center justify-end gap-8px'>
        {failed ? (
          <Typography.Text className='mr-auto text-11px text-danger-6'>{t('common.saveFailed')}</Typography.Text>
        ) : null}
        <Button size='small' disabled={!dirty || saving} onClick={() => setDraft(base)}>
          {t('settings.memory.revert')}
        </Button>
        <Button size='small' type='primary' loading={saving} disabled={!dirty} onClick={() => void save()}>
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
};

export default MemoryDocEditor;
