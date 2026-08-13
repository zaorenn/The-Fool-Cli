/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Input, Modal, Radio, Typography } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CONFIRM_NO, CONFIRM_YES, type OutstandingQuestion } from '@/common/permissions/pendingQuestions';
import { answerQuestion, skipQuestion, subscribeToQuestions } from '@renderer/services/permissions/questionStore';

/**
 * The question a task stopped on, and the answer that starts it again.
 *
 * Mounted once at the root beside `PermissionAskCard`, and for the same reason:
 * what is waiting is a running task, and a task does not belong to a page. A
 * form being filled from something said out loud can need a date of birth with
 * the window minimised and no chat open.
 *
 * The two cards are deliberately different in one place. A permission card can
 * be dismissed — the escape key means no, and no is a safe answer. This one
 * cannot: closing it has to be a decision the user made about the field, so the
 * only ways out are answering it and saying to leave it blank. Escaping into an
 * unfilled form that reports itself as filled is the failure this whole feature
 * is built to avoid.
 */
export const QuestionAskCard: React.FC = () => {
  const { t } = useTranslation();
  const [outstanding, setOutstanding] = useState<readonly OutstandingQuestion[]>([]);
  const [typed, setTyped] = useState('');

  useEffect(() => subscribeToQuestions(setOutstanding), []);

  const question = outstanding[0];
  const questionId = question?.id;

  // A new question starts with an empty box. Without this the answer to the
  // last field is sitting in the next one, one keystroke from being submitted.
  useEffect(() => {
    setTyped('');
  }, [questionId]);

  if (question === undefined) return null;

  const submitText = (): void => {
    // A rejected answer leaves the question standing, which is what the store
    // does with anything that does not fit. Nothing to report here: the box
    // still has their words in it and the question is still on screen.
    answerQuestion(question.id, typed);
  };

  return (
    <Modal
      visible
      title={t('settings.permissions.questionTitle')}
      maskClosable={false}
      escToExit={false}
      closable={false}
      onCancel={() => skipQuestion(question.id)}
      footer={
        <div className='flex justify-end gap-8px'>
          <Button onClick={() => skipQuestion(question.id)}>{t('settings.permissions.questionSkip')}</Button>
          {question.shape.kind === 'text' ? (
            <Button type='primary' disabled={typed.trim().length === 0} onClick={submitText}>
              {t('settings.permissions.questionAnswer')}
            </Button>
          ) : null}
        </div>
      }
    >
      <Typography.Paragraph className='mb-8px'>{question.prompt}</Typography.Paragraph>
      {question.context ? (
        <Typography.Paragraph type='secondary' className='mt-0 mb-12px'>
          {question.context}
        </Typography.Paragraph>
      ) : null}

      {question.shape.kind === 'text' ? (
        <Input
          autoFocus
          value={typed}
          onChange={setTyped}
          onPressEnter={submitText}
          placeholder={t('settings.permissions.questionPlaceholder')}
        />
      ) : null}

      {question.shape.kind === 'choice' ? (
        <Radio.Group
          direction='vertical'
          value={typed}
          onChange={(value: string) => {
            setTyped(value);
            // Chosen from a list the form itself declared, so it fits by
            // construction: resolved on the click rather than behind a second
            // button nobody would understand the purpose of.
            answerQuestion(question.id, value);
          }}
          options={question.shape.options.map((option) => ({ label: option, value: option }))}
        />
      ) : null}

      {question.shape.kind === 'confirm' ? (
        <div className='flex gap-8px'>
          <Button type='primary' onClick={() => answerQuestion(question.id, CONFIRM_YES)}>
            {t('settings.permissions.questionYes')}
          </Button>
          <Button onClick={() => answerQuestion(question.id, CONFIRM_NO)}>
            {t('settings.permissions.questionNo')}
          </Button>
        </div>
      ) : null}
    </Modal>
  );
};
