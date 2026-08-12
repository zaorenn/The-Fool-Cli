import type { ICssTheme } from '@/common/config/storage';
import type { Theme } from '@/common/theme/types';
import type { LayoutPresetLibrary, SurfaceLayoutSelection } from '@/common/config/surfaceLayouts';
import type { ThemeOverrides, ThemePalettes } from '@/common/config/themeOverrides';
import type { WorkspaceLibrary } from '@/common/config/workspaces';
import type { ConnectorGrant } from '@/common/permissions/connectors';
import type { Rule } from '@/common/permissions/types';
import type { SavedPersona } from '@/common/realtime/personas';
import type { MemoryProposal } from '@/common/voice/memoryProposal';
import type { LocalSkill } from '@/common/voice/localSkills';
import type { SurfaceStyleChoice } from '@/common/theme/surfaceChoice';
import type { SurfaceBackground } from '@/common/theme/surfaceBackground';

export type ConfigKeyMap = {
  language: string;
  theme: string;
  colorScheme: string;
  'ui.zoomFactor': number | undefined;
  'ui.fontSize.chat': number | undefined;
  'ui.fontSize.markdown': number | undefined;
  'ui.fontSize.code': number | undefined;
  'ui.themeOverrides': ThemeOverrides | undefined;
  /** Palettes the user asked to keep, recalled out loud by their own name. */
  'ui.themePalettes': ThemePalettes | undefined;
  /**
   * What shape each window is wearing, which is a separate question from colour.
   *
   * A theme decides what the app looks like everywhere; this decides what one
   * surface is laid out like, so someone can keep their colours and still change
   * the voice page from a column into a dial.
   */
  'ui.surfaceLayouts': SurfaceLayoutSelection | undefined;
  /** Layouts the user built and named, recalled the same way a palette is. */
  'ui.layoutPresets': LayoutPresetLibrary | undefined;
  /**
   * What the application is made of, and the one colour the rest derives from.
   *
   * A third question, beside the other two: a theme decides the colours, a
   * layout decides the composition, and this decides the material — whether a
   * panel is raised out of the ground, a pane of glass with a lit world behind
   * it, or paper with a shadow that does not blur. One choice, and every
   * surface follows it without being rewritten.
   */
  'ui.surfaceStyle': SurfaceStyleChoice | undefined;
  /**
   * A picture behind the application, how much of it shows, and its blur.
   *
   * Its own key rather than a field of the material: a photograph is not a
   * material, it survives changing one, and it is the one value here big enough
   * that reading it should be a deliberate act rather than a side effect.
   */
  'ui.surfaceBackground': SurfaceBackground | undefined;
  /** Things the user taught the assistant to do by itself. */
  'voice.localSkills': LocalSkill[] | undefined;
  /**
   * What the user has said they never want to be asked about again.
   *
   * Their own list, kept apart from this application's defaults so an update can
   * change its own opinion without touching theirs — and so both can be read
   * separately when somebody asks why something was allowed.
   */
  'permissions.userRules': Rule[] | undefined;
  /**
   * The whole app aimed at one purpose, by name.
   *
   * Layout, persona, agent, model and skills bundled together, because every one
   * of those is global and a person who uses this app for two different things
   * needs two different answers to all of them at once.
   */
  'workspaces.library': WorkspaceLibrary | undefined;
  /** Which of them is in force. */
  'workspaces.activeId': string | undefined;
  /** The chat that spoken turns go to, until the user asks for a new one. */
  'voice.boundConversationId': string | undefined;
  /**
   * The model that last produced a spoken English summary.
   *
   * Remembered so the next launch starts with a model that is already loaded
   * rather than paying the cold start again on the first thing said.
   */
  'voice.summaryModelId': string | undefined;
  /**
   * Assistants the user wrote, kept under names they chose.
   *
   * The four presets are the four things this was built for. Anything else has
   * always been writable into the one custom box, where it lasted until they
   * wanted the other one back — see `SavedPersona`.
   */
  'voice.personas': SavedPersona[] | undefined;
  /**
   * Things the assistant thinks it learned, waiting for the user to agree.
   *
   * Offered rather than written, because the most damaging thing a memory can
   * do is be confidently wrong about somebody. See `MemoryProposal`.
   */
  'voice.memoryProposals': MemoryProposal[] | undefined;
  /**
   * Lines the user has turned down.
   *
   * Kept so that being told no means something: a loop that offers the same
   * sentence every evening is not learning, it is nagging.
   */
  'voice.memoryRefusals': string[] | undefined;
  /**
   * Subjects the assistant has already had its one chance to ask about.
   *
   * The curiosity layer asks at most one question per conversation, and never
   * the same subject twice — not "not twice in a session", never again. A
   * subject goes on this list the moment it is asked, not when it is answered,
   * because the two failures are not symmetric: forgetting something the user
   * told you is repairable by asking once more, and asking a question somebody
   * has already declined to answer is the thing that gets an assistant switched
   * off. Repaired on read by `sanitizeRefusedSubjects`.
   */
  'voice.curiosityRefusals': string[] | undefined;
  /**
   * Which orb the pet window draws while a conversation is running.
   *
   * Here rather than beside the skins themselves because the main process reads
   * it to answer the pet window, and the main process must not import from the
   * renderer. The value is a skin id; one that no longer exists falls back to
   * the default rather than leaving an empty window — see `orbSkinById`.
   */
  'voice.orbSkin': string | undefined;
  /**
   * What the user has allowed each connected service to be asked for.
   *
   * One answer per capability rather than one per service: "connect Spotify" is
   * one click and is how somebody ends up having agreed to let an assistant
   * write to a playlist they have kept for ten years. See `ConnectorGrant`.
   */
  'connectors.grants': ConnectorGrant[] | undefined;
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
  /**
   * The version whose changes have already been shown, so they are shown once.
   *
   * Absent means this copy has never recorded one — a fresh install, or a build
   * older than the feature. The two are told apart by whether the window has
   * ever saved its position. See `WhatsNewModal`.
   */
  'system.lastSeenVersion': string | undefined;
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

/** Where the chosen orb is kept, named once so both processes agree. */
export const ORB_SKIN_CONFIG_KEY = 'voice.orbSkin' as const;

/**
 * The orb drawn when nothing has been chosen.
 *
 * A plain string rather than an import from the skin registry: the main process
 * needs this value and cannot reach into the renderer, and a default that lived
 * only beside the skins would have to be duplicated to get here — which is
 * exactly how the two come to disagree.
 */
export const DEFAULT_ORB_SKIN = 'reactor';
