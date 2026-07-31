import type { ICssTheme } from '@/common/config/storage';
import type { Theme } from '@/common/theme/types';
import type { ThemeOverrides } from '@/common/config/themeOverrides';

export type ConfigKeyMap = {
  language: string;
  theme: string;
  colorScheme: string;
  'ui.zoomFactor': number | undefined;
  'ui.fontSize.chat': number | undefined;
  'ui.fontSize.markdown': number | undefined;
  'ui.fontSize.code': number | undefined;
  'ui.themeOverrides': ThemeOverrides | undefined;
  /** The chat that spoken turns go to, until the user asks for a new one. */
  'voice.boundConversationId': string | undefined;
  /**
   * The model that last produced a spoken English summary.
   *
   * Remembered so the next launch starts with a model that is already loaded
   * rather than paying the cold start again on the first thing said.
   */
  'voice.summaryModelId': string | undefined;
  'window.bounds': { x?: number; y?: number; width: number; height: number } | undefined;
  'webui.desktop.enabled': boolean | undefined;
  'webui.desktop.allowRemote': boolean | undefined;
  'webui.desktop.port': number | undefined;
  customCss: string;
  'css.themes': ICssTheme[];
  'css.activeThemeId': string;
  'theme.activeId': string;
  'theme.userThemes': Theme[];
  'workspace.pasteConfirm': boolean | undefined;
  'guid.lastAssistantId': string | undefined;
  /** User-defined order for the enabled assistant picker surfaces. */
  'assistants.enabledOrder': string[] | undefined;
  'upload.saveToWorkspace': boolean | undefined;
  'system.closeToTray': boolean | undefined;
  'system.notificationEnabled': boolean | undefined;
  'system.cronNotificationEnabled': boolean | undefined;
  'system.keepAwake': boolean | undefined;
  'system.autoPreviewOfficeFiles': boolean | undefined;
  /**
   * Set once The Jester has been handed the first-launch setup, so a returning
   * user is never dropped back into onboarding.
   */
  'system.firstRunGreeted': boolean | undefined;
  'skillsMarket.enabled': boolean | undefined;
  'pet.enabled': boolean | undefined;
  'pet.size': number | undefined;
  'pet.dnd': boolean | undefined;
  'pet.confirmEnabled': boolean | undefined;
  // One-shot completion flags for legacy → backend migrations. Kept in the
  // local config file (not the backend client-preferences bag) so a downgrade
  // to a pre-flag build still re-reads the legacy data unchanged. See
  // `migrateProviders` / `migrateAssistantsToBackend` (ELECTRON-1KT).
  'migration.providersMigrated_v1': boolean | undefined;
  'migration.assistantsMigrated_v1': boolean | undefined;
};

export type ConfigKey = keyof ConfigKeyMap;
