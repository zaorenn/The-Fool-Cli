/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Card, Typography } from '@arco-design/web-react';
import { Attention, CheckOne } from '@icon-park/react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePermissionDock } from './PermissionDock';
import { useTranslation } from 'react-i18next';
import styles from './PermissionRequestPanel.module.css';
import {
  getPermissionOptionsIdentity,
  type PermissionOperationKind,
  type PermissionPanelOption,
} from './permissionOptions';

const { Text } = Typography;

/**
 * Which panel the number keys belong to.
 *
 * A conversation keeps every permission request it has ever shown, so several
 * panels are mounted at once and a bare window listener would answer all of
 * them at the same time. The newest unanswered one claims the keys; the rest
 * stay clickable but deaf.
 */
let keyboardOwner: symbol | null = null;

/** Highest option a single keystroke can reach. */
const MAX_NUMBERED_OPTIONS = 9;

/** Identifies the "type your own answer" choice, which opens a field rather than answering. */
const CUSTOM_ANSWER_ID = '__custom_answer__';

const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
};

type PermissionRequestPanelProps = {
  requestKey: string;
  testIdPrefix: 'message-permission' | 'message-acp-permission';
  title: string;
  description?: string;
  operationKind: PermissionOperationKind;
  detail?: string;
  options: PermissionPanelOption[];
  onConfirm: (optionValue: string) => Promise<void>;
  /**
   * Offer a final choice that takes free text instead of picking a listed
   * option. Set for question cards, where the agent's suggestions are guesses
   * and the real answer is often none of them.
   */
  allowCustomAnswer?: boolean;
};

export const PermissionRequestPanel: React.FC<PermissionRequestPanelProps> = ({
  requestKey,
  testIdPrefix,
  title,
  description,
  operationKind,
  detail,
  options,
  onConfirm,
  allowCustomAnswer = false,
}) => {
  const { t } = useTranslation();
  const optionsIdentity = getPermissionOptionsIdentity(options);
  const [isResponding, setIsResponding] = useState(false);
  const [hasResponded, setHasResponded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const respondingRef = useRef(false);
  const requestEpochRef = useRef(0);
  const optionsEpochRef = useRef(0);
  const optionsLabelId = useId();
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState('');
  const customInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    requestEpochRef.current += 1;
    respondingRef.current = false;
    setIsResponding(false);
    setHasResponded(false);
    setHasError(false);
    setSubmittingId(null);
    setCustomOpen(false);
    setCustomText('');
  }, [requestKey]);

  useEffect(() => {
    optionsEpochRef.current += 1;
    setHasError(false);
    setHasResponded(false);
  }, [optionsIdentity]);

  // Every option submits on a single click (allow/reject, once or always,
  // plus neutral) — there is no separate confirm step. The in-flight guard
  // (respondingRef) drops double-clicks and clicks during submission, and the
  // request/option epoch guards ignore results that resolve after the request
  // or the option set has changed underneath us.
  const submitOption = useCallback(
    async (option: PermissionPanelOption) => {
      if (respondingRef.current || hasResponded || option.disabled) return;

      const requestEpoch = requestEpochRef.current;
      const optionsEpoch = optionsEpochRef.current;
      respondingRef.current = true;
      setIsResponding(true);
      setSubmittingId(option.id);
      setHasError(false);

      try {
        await onConfirm(option.value);
        if (requestEpochRef.current === requestEpoch && optionsEpochRef.current === optionsEpoch) {
          setHasResponded(true);
        }
      } catch {
        if (requestEpochRef.current === requestEpoch && optionsEpochRef.current === optionsEpoch) {
          setHasError(true);
        }
      } finally {
        if (requestEpochRef.current === requestEpoch) {
          respondingRef.current = false;
          setIsResponding(false);
          setSubmittingId(null);
        }
      }
    },
    [hasResponded, onConfirm]
  );

  const submitCustomAnswer = useCallback(() => {
    const answer = customText.trim();
    if (!answer) return;
    // Reuses the option path so epochs, the responding guard and the error
    // state all behave exactly as they do for a listed choice.
    void submitOption({
      id: CUSTOM_ANSWER_ID,
      value: answer,
      label: answer,
      intent: 'neutral',
      testId: `${testIdPrefix}-option-custom-submit`,
    });
  }, [customText, submitOption, testIdPrefix]);

  const panelId = useRef<symbol>(Symbol('permission-panel'));
  const customOption: PermissionPanelOption | null = allowCustomAnswer
    ? {
        id: CUSTOM_ANSWER_ID,
        value: CUSTOM_ANSWER_ID,
        label: t('messages.answerInYourOwnWords'),
        intent: 'neutral',
        testId: `${testIdPrefix}-option-custom`,
      }
    : null;
  const visibleOptions = customOption ? [...options, customOption] : options;
  const numbered = visibleOptions.slice(0, MAX_NUMBERED_OPTIONS);
  const awaitingAnswer = !hasResponded && numbered.length > 0;

  // The newest unanswered panel takes the keys, and hands them back when it is
  // answered or unmounted — so scrolling back through old requests never leaves
  // a stale panel listening.
  useEffect(() => {
    if (!awaitingAnswer) return;
    const id = panelId.current;
    keyboardOwner = id;
    return () => {
      if (keyboardOwner === id) keyboardOwner = null;
    };
  }, [awaitingAnswer, requestKey, optionsIdentity]);

  useEffect(() => {
    if (!awaitingAnswer) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (keyboardOwner !== panelId.current) return;
      // A modifier means the keystroke belongs to a shortcut, and a focused
      // composer means the user is typing "1" rather than choosing option one.
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;

      const option = numbered[Number(event.key) - 1];
      if (!option || option.disabled) return;

      event.preventDefault();
      if (option.id === CUSTOM_ANSWER_ID) {
        setCustomOpen(true);
        return;
      }
      void submitOption(option);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [awaitingAnswer, numbered, submitOption]);

  const dock = usePermissionDock();

  const card = (
    <Card className={styles.card} bordered={false} data-testid={`${testIdPrefix}-card`}>
      <div className={styles.panel} aria-busy={isResponding}>
        <div className={styles.heading}>
          <div className={styles.titleRow}>
            <Text className={styles.title}>{title}</Text>
            <Text className={styles.operationBadge}>{operationKind}</Text>
          </div>
          {description && <Text className={styles.description}>{description}</Text>}
        </div>

        {detail && (
          <div className={styles.detailBlock}>
            <Text className={styles.detailLabel}>{t('messages.command')}</Text>
            <code className={styles.detail} dir='auto'>
              {detail}
            </code>
          </div>
        )}

        {!hasResponded && (
          <>
            <fieldset className={styles.optionsFieldset} disabled={isResponding}>
              <legend id={optionsLabelId} className={styles.optionsLegend}>
                {t('messages.chooseAction')}
              </legend>
              {options.length > 0 ? (
                <div
                  className={styles.optionsGroup}
                  role='group'
                  aria-labelledby={optionsLabelId}
                  data-testid={`${testIdPrefix}-options`}
                >
                  {visibleOptions.map((option, index) => (
                    <Button
                      key={option.id}
                      className={styles.optionButton}
                      data-testid={option.testId}
                      data-disabled={Boolean(option.disabled || isResponding)}
                      disabled={option.disabled || isResponding}
                      loading={submittingId === option.id}
                      onClick={() => {
                        if (option.id === CUSTOM_ANSWER_ID) {
                          setCustomOpen(true);
                          return;
                        }
                        void submitOption(option);
                      }}
                    >
                      {index < MAX_NUMBERED_OPTIONS && (
                        <span className={styles.optionKey} aria-hidden='true' data-testid={`${option.testId}-key`}>
                          {index + 1}
                        </span>
                      )}
                      <span className={styles.optionLabel}>{option.label}</span>
                    </Button>
                  ))}
                </div>
              ) : (
                <Text className={styles.emptyState}>{t('messages.noOptionsAvailable')}</Text>
              )}
            </fieldset>

            {customOpen && (
              <div className={styles.customAnswer} data-testid={`${testIdPrefix}-custom`}>
                <textarea
                  ref={customInputRef}
                  className={styles.customInput}
                  value={customText}
                  autoFocus
                  rows={2}
                  disabled={isResponding}
                  placeholder={t('messages.answerPlaceholder')}
                  aria-label={t('messages.answerInYourOwnWords')}
                  data-testid={`${testIdPrefix}-custom-input`}
                  onChange={(event) => setCustomText(event.target.value)}
                  onKeyDown={(event) => {
                    // Enter sends, Shift+Enter breaks the line — the same
                    // contract the composer below this card already uses.
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      submitCustomAnswer();
                    }
                  }}
                />
                <div className={styles.customActions}>
                  <Button
                    size='small'
                    disabled={isResponding}
                    onClick={() => {
                      setCustomOpen(false);
                      setCustomText('');
                    }}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    size='small'
                    type='primary'
                    disabled={isResponding || !customText.trim()}
                    loading={submittingId === CUSTOM_ANSWER_ID}
                    data-testid={`${testIdPrefix}-custom-submit`}
                    onClick={submitCustomAnswer}
                  >
                    {t('messages.sendAnswer')}
                  </Button>
                </div>
              </div>
            )}

            {hasError && (
              <div
                className={classNames(styles.feedback, styles.error)}
                role='alert'
                aria-live='assertive'
                data-testid={`${testIdPrefix}-error`}
              >
                <Attention theme='outline' size='16' aria-hidden='true' />
                <span>{t('messages.permissionResponseFailed')}</span>
              </div>
            )}
          </>
        )}

        {hasResponded && (
          <div
            className={classNames(styles.feedback, styles.success)}
            role='status'
            aria-live='polite'
            data-testid={`${testIdPrefix}-status`}
          >
            <CheckOne theme='outline' size='16' aria-hidden='true' />
            <span>{t('messages.responseSentSuccessfully')}</span>
          </div>
        )}
      </div>
    </Card>
  );

  // Painted above the composer where a dock exists, so scrolling the
  // conversation never hides the request the keyboard shortcuts act on.
  return dock ? createPortal(card, dock) : card;
};
