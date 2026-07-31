/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useTalkToJester } from '@/renderer/hooks/assistant/useTalkToJester';
import { Robot } from '@icon-park/react';
import classNames from 'classnames';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

type JesterDiagnoseButtonProps = {
  /** Error text handed to the Jester as diagnosis context. */
  errorText: string;
  /** Additional classes appended to the default pill styling. */
  className?: string;
};

/**
 * Inline "ask the Jester" chip shown next to FeedbackButton on error surfaces.
 * Instead of filing a report, it routes the user to the home chat with the
 * The Fool Jester selected and a diagnosis prompt (including the error text)
 * pre-filled — the same flow as the report modal's "Solve via chat" action.
 */
const JesterDiagnoseButton: React.FC<JesterDiagnoseButtonProps> = ({ errorText, className }) => {
  const { t } = useTranslation();
  const talkToJester = useTalkToJester();

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      event.stopPropagation();
      const prompt = t('settings.talkToJester.prompt.diagnoseChatError', {
        defaultValue:
          'I ran into an error during a conversation in The Fool, please help me diagnose it.\n\n[Error] {{error}}\n\nPlease diagnose the cause and tell me how to fix it.',
        error: errorText.trim(),
      });
      talkToJester({ prompt }).catch((err) => {
        console.error('[JesterDiagnoseButton] Failed to open jester chat:', err);
      });
    },
    [errorText, t, talkToJester]
  );

  return (
    <button
      type='button'
      role='button'
      onClick={handleClick}
      className={classNames(
        'inline-flex items-center gap-3px cursor-pointer select-none b-none',
        'px-8px py-4px rd-16px',
        'bg-transparent hover:bg-fill-2 text-t-primary',
        'text-13px leading-18px transition-colors duration-150',
        className
      )}
    >
      {/* No pt offset: @icon-park's Robot glyph is vertically centered in its
          viewBox (unlike Comment in FeedbackButton), so items-center alone
          lines it up with the text baseline. */}
      <Robot theme='outline' size='14' fill='currentColor' className='flex-shrink-0' />
      <span>{t('settings.talkToJester.solveWithJester')}</span>
    </button>
  );
};

export default JesterDiagnoseButton;
