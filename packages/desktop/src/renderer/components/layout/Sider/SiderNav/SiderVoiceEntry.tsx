import React from 'react';
import { Button, Tooltip } from '@arco-design/web-react';
import { Voice } from '@icon-park/react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';

type SiderVoiceEntryProps = {
  isMobile: boolean;
  isActive: boolean;
  collapsed: boolean;
  siderTooltipProps: SiderTooltipProps;
  onClick: () => void;
};

const SiderVoiceEntry: React.FC<SiderVoiceEntryProps> = ({
  isMobile,
  isActive,
  collapsed,
  siderTooltipProps,
  onClick,
}) => {
  const { t } = useTranslation();
  const label = t('settings.voice.conversationModeTitle');

  return (
    <Tooltip {...siderTooltipProps} content={label} position='right'>
      <Button
        type='text'
        long
        aria-label={label}
        onClick={onClick}
        className={classNames(
          '!box-border !h-34px !min-h-34px !rounded-8px !px-10px !text-t-primary',
          collapsed ? '!flex !w-full !items-center !justify-center !px-0' : '!flex !items-center !justify-start',
          isMobile && 'sider-action-btn-mobile',
          isActive ? '!bg-fill-3' : 'hover:!bg-fill-3 active:!bg-fill-4'
        )}
      >
        <span className='flex size-22px shrink-0 items-center justify-center'>
          <Voice theme={isActive ? 'filled' : 'outline'} size={collapsed ? 20 : 16} />
        </span>
        {!collapsed ? <span className='ml-8px text-14px font-500'>{label}</span> : null}
      </Button>
    </Tooltip>
  );
};

export default SiderVoiceEntry;
