/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { notifyManualRestartRequired } from '@/renderer/utils/appRestart';
import { Alert, Button, Message, Modal, Switch } from '@arco-design/web-react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR, { mutate } from 'swr';
import PreferenceRow from './PreferenceRow';

/**
 * Õ║öö¿ÕåàµÁÅ×ğêÕÖ¿×«¥¢« / In-app browser settings.
 *
 * ×┐Öõ©Ç×èéÕÇ╝Õ¥ùï¼½ïÕ¡İÕ£¿´╝î×Çîõ©ıµİ»ÕíŞ×┐øÕ╝ÇÕÅæ×Çà×«¥¢«´╝Ü
 * - Ö╗Õ¢òµÇüµİ»Õà¿Õ▒ÇÕà▒õ║½Üä´╝êµëÇµ£ë tabÒÇüµëÇµ£ëÚí╣ø«Õà▒ö¿´╝ë´╝îö¿µêÀÚ£Ç×Ğüõ©Çõ©¬µİÄí«ÜäÕ£░µû╣şÑÚüô
 *   ÒÇîµêæÜäÖ╗Õ¢òõ┐íµü»Õ¡İÕ£¿Õô¬ÒÇüµÇÄõ╣êµ©àµÄëÒÇı´╝ø
 * - ÒÇîÕàü×«© Agent µôıõ¢£µÁÅ×ğêÕÖ¿ÒÇıµİ»Õ«ëÕà¿Õ╝ÇÕà│´╝îÕ┐àÚí╗Õ£¿µ¡úÕ╝ÅëêÕÅ»×ğüÒÇéÕ╝ÇÕÅæ×Çà×«¥¢«µò┤×èéÕ£¿µëôÕîàëêµ£¼Úçî
 *   return null´╝îµèèÕ╝ÇÕà│µö¥ÚéúÕä┐¡ëõ║Äµ¡úÕ╝Åëêö¿µêÀµá╣µ£¼µ▓íµ£ëÕ╝ÇÕà│ÕÅ»Õà│´╝î×Çî×┐Öõ©¬×â¢ÕèøÚ╗İ×«ñµİ»Õ╝ÇØÇÜä
 *   ÔÇöÔÇö ÚéúÕ░▒õ©ıÕÅ½ÒÇîÕÅ»ÚÇëÒÇıõ║åÒÇé
 *
 * This section stands on its own rather than living under developer settings:
 * - sign-in state is global (shared across every tab and project), so the user needs
 *   an obvious place to learn where those credentials live and how to remove them;
 * - "let the agent drive the browser" is a security switch and must be visible in
 *   production builds. The whole developer-settings section returns null when packaged,
 *   so putting the switch there would leave production users with no way to turn off a
 *   capability that defaults to on ÔÇö which would make it not really optional.
 */
const BrowserDataSection: React.FC = () => {
  const { t } = useTranslation();
  const [clearing, setClearing] = useState(false);
  const { data: cdpStatus, isLoading } = useSWR('cdp.status', () => ipcBridge.application.getCdpStatus.invoke());
  const [switchLoading, setSwitchLoading] = useState(false);

  const status = cdpStatus?.data;

  /**
   * Õ╝ÇÕà│ÕåÖÜäµİ»Úàı¢«´╝î£şµ¡úöşµòê×Ğü¡ëõ©ïµ¼íÕÉ»Õè¿ ÔÇöÔÇö ÚÇÜÚüôÚÜÅ×┐ø¿ïÕêøÕ╗║ÒÇéõ©ñ×Çàõ©ıõ©Ç×ç┤µùÂµÅÉñ║ÚçıÕÉ»ÒÇé
   * The switch writes config; it takes effect on the next launch because the bridge is
   * created with the process. Prompt for a restart while the two disagree.
   */
  const agentControlEnabled = status?.configEnabled ?? false;
  const hasPendingChange = !isLoading && status !== undefined && status.configEnabled !== status.enabled;

  const handleToggleAgentControl = useCallback(
    async (checked: boolean) => {
      setSwitchLoading(true);
      try {
        const result = await ipcBridge.application.updateCdpConfig.invoke({ enabled: checked });
        if (result.success) {
          Message.success(t('settings.browserData.agentControlSaved'));
          await mutate('cdp.status');
        } else {
          Message.error(result.msg || t('settings.browserData.agentControlFailed'));
        }
      } catch {
        Message.error(t('settings.browserData.agentControlFailed'));
      } finally {
        setSwitchLoading(false);
      }
    },
    [t]
  );

  const handleRestart = useCallback(async () => {
    try {
      const result = await ipcBridge.application.restart.invoke();
      notifyManualRestartRequired(result, t);
    } catch {
      Message.error(t('common.error'));
    }
  }, [t]);

  const handleClear = useCallback(() => {
    // õ║îµ¼íí«×«ñ´╝Üµ©àµÄëõ╣ïÕÉÄµëÇµ£ë¢æ½ÖÚâ¢×ĞüÚçıµû░Ö╗Õ¢ò´╝îõ©öõ©ıÕÅ»µÆñÚöÇ
    // Confirm first: this signs out of every site and cannot be undone.
    Modal.confirm({
      title: t('settings.browserData.clearConfirmTitle'),
      content: t('settings.browserData.clearConfirmContent'),
      okButtonProps: { status: 'danger' },
      onOk: async () => {
        setClearing(true);
        try {
          const result = await ipcBridge.application.clearBrowserData.invoke();
          if (result.success) {
            Message.success(t('settings.browserData.clearSuccess'));
          } else {
            Message.error(result.msg || t('settings.browserData.clearFailed'));
          }
        } catch {
          Message.error(t('settings.browserData.clearFailed'));
        } finally {
          setClearing(false);
        }
      },
    });
  }, [t]);

  return (
    <div className='px-[12px] md:px-[32px] py-16px bg-2 rd-16px'>
      <div className='text-14px font-medium text-t-primary mb-8px'>{t('settings.browserData.title')}</div>

      <PreferenceRow
        label={t('settings.browserData.agentControlLabel')}
        description={t('settings.browserData.agentControlDesc')}
      >
        <Switch
          checked={agentControlEnabled}
          loading={switchLoading || isLoading}
          onChange={handleToggleAgentControl}
        />
      </PreferenceRow>

      {hasPendingChange && (
        <Alert
          type='warning'
          content={
            <div className='flex items-center justify-between gap-12px'>
              <span>{t('settings.browserData.agentControlRestartRequired')}</span>
              <Button size='small' type='primary' onClick={handleRestart}>
                {t('settings.restartNow')}
              </Button>
            </div>
          }
          className='mb-8px'
        />
      )}

      <PreferenceRow label={t('settings.browserData.clearLabel')} description={t('settings.browserData.clearDesc')}>
        <Button size='small' status='danger' loading={clearing} onClick={handleClear}>
          {t('common.clear')}
        </Button>
      </PreferenceRow>
    </div>
  );
};

export default BrowserDataSection;
