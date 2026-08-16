// WebUI 状态接口 / WebUI status interface
export interface WebUIStatus {
  running: boolean;
  port: number;
  allowRemote: boolean;
  localUrl: string;
  networkUrl?: string;
  lanIP?: string;
  adminUsername: string;
  initialPassword?: string;
}

export interface ElectronBridgeAPI {
  emit: (name: string, data: unknown) => Promise<unknown> | void;
  on: (callback: (event: { value: string }) => void) => void;
  // 获取拖拽文件/目录的绝对路径 / Get absolute path for dragged file/directory
  getPathForFile?: (file: File) => string;
  // Feedback log collection / 收集反馈日志
  collectFeedbackLogs?: () => Promise<{ filename: string; data: number[] } | null>;
  // Feedback screenshot capture / 反馈截图
  captureFeedbackScreenshot?: () => Promise<{ filename: string; data: number[] } | null>;
  /**
   * The whole display the pointer is on — not just this window. Null when the
   * capture is unavailable or fails.
   */
  captureScreen?: () => Promise<{ filename: string; data: number[] } | null>;
  /**
   * Opens the selection overlay and captures whatever the user drags a box
   * around. Null when they cancel, or when the capture fails.
   */
  captureScreenRegion?: () => Promise<{ filename: string; data: number[] } | null>;
  /**
   * One named application's window, rather than the whole display.
   *
   * The picture nearly every spoken question actually wants, and less of the
   * user's screen than the whole of it. Null when no window matches the name —
   * there is no fallback to the display, because "that is not open" is the
   * honest answer and a wider photograph answers a different question.
   */
  captureWindow?: (match: string) => Promise<{ filename: string; data: number[] } | null>;
  /**
   * Which window a name refers to, as a title and a capture id, without
   * photographing anything.
   *
   * Paired with `captureWindowFrame` in the renderer, which opens a stream
   * carrying only that window. Asking the main process for the picture instead
   * costs a rendered thumbnail of every window the user has open.
   */
  resolveWindow?: (match: string) => Promise<{ id: string; name: string } | null>;
  /**
   * Finds something on the web, and optionally saves it, without opening the
   * user's browser.
   *
   * The route "find me a PDF about X" was missing entirely: every path to the
   * web went through `shell.openExternal`, so a request about a document could
   * only be answered by taking over the user's screen. This fetches the results
   * page, picks the address that actually serves the file, saves it into a
   * folder this app owns, and answers with the path.
   */
  findOnWeb?: (payload: { query: string; kind?: 'pdf' | 'doc' | 'page'; fetch?: boolean }) => Promise<
    | {
        // Discriminated by a string rather than by `ok: true/false`. This
        // project builds without `strictNullChecks`, and a boolean literal does
        // not narrow a union under it — the compiler keeps both arms alive and
        // every field access on either is an error.
        status: 'found';
        results: { title: string; url: string; snippet: string }[];
        chosen?: { title: string; url: string; snippet: string };
        saved?: { path: string; bytes: number };
      }
    | { status: 'failed'; reason: string; detail?: string }
  >;
  /**
   * The documents already fetched on the user's behalf, newest first.
   *
   * The way back when the automatic open did not happen. It reads the folder
   * rather than the conversation, so a document is still reachable after the
   * transcript it was mentioned in has gone.
   */
  listFoundDocuments?: () => Promise<{ path: string; name: string; bytes: number; at: number }[]>;
  /**
   * Whether that path is really a file on disk.
   *
   * Asked before opening a viewer, because a model can name a document it never
   * wrote and every layer below will happily carry the name.
   */
  documentExists?: (filePath: string) => Promise<boolean>;
  // Forward feedback diagnostics logs to the main process console / 转发反馈诊断日志到主进程控制台
  logFeedbackEvent?: (payload: { details?: unknown; level: 'info' | 'warn' | 'error'; message: string }) => void;
  recoverCorruptedDatabase?: () => Promise<void>;
  /**
   * The folder a spoken "build me an app" builds into.
   *
   * Chosen by the main process rather than by the caller: it is also the only
   * place {@link servePreview} will serve from.
   */
  previewWorkspaceRoot?: () => Promise<string>;
  /**
   * Serves a built app over loopback and hands back the address to open.
   *
   * One at a time; a second call replaces the first. Refuses anything outside
   * the workspace root, and anything with no `index.html` in it.
   */
  servePreview?: (directory: string) => Promise<PreviewResult>;
  stopPreview?: () => Promise<void>;
  /**
   * Watches the user demonstrate something, so it can be written up as a skill.
   *
   * A frame every couple of seconds into a folder of its own, never on a timer
   * nobody asked for: it starts when the user says "let me show you", and stops
   * on their word or on its own after six minutes.
   */
  startSkillRecording?: (name: string) => Promise<string>;
  stopSkillRecording?: () => Promise<SkillRecordingResult | null>;
  cancelSkillRecording?: () => Promise<void>;
  /** A folder for a skill that was described rather than demonstrated. */
  prepareSkillFolder?: (name: string) => Promise<string>;
  /** Writes the assistant's first draft beside the frames, and nowhere else. */
  writeSkillDraft?: (folder: string, body: string) => Promise<boolean>;
  /**
   * A workspace's own page, served over loopback with the bridge injected.
   *
   * One at a time; a second call replaces the first. Refuses anything outside
   * the workspace-apps folder, and anything whose entry file is not there.
   */
  serveWorkspaceApp?: (folder: string, entry: string) => Promise<ServedWorkspaceApp>;
  stopWorkspaceApp?: () => Promise<void>;
  prepareWorkspaceApp?: (folder: string) => Promise<string>;
  /** The app's text files, for putting one into a workspace file. */
  readWorkspaceApp?: (folder: string) => Promise<Record<string, string>>;
  /** Writes one out of a file somebody sent, each path confined to the folder. */
  writeWorkspaceApp?: (folder: string, files: Record<string, string>) => Promise<number>;
  removeWorkspaceApp?: (folder: string) => Promise<void>;
}

/** What {@link ElectronBridgeAPI.serveWorkspaceApp} answers with. */
export type ServedWorkspaceApp =
  | { ok: true; url: string; root: string }
  | { ok: false; reason: 'not-a-folder' | 'no-entry' | 'failed' };

/** What {@link ElectronBridgeAPI.servePreview} answers with. */
export type PreviewResult = { ok: true; url: string } | { ok: false; reason: 'no-entry' | 'not-a-folder' | 'failed' };

/** What a finished demonstration leaves behind. */
export type SkillRecordingResult = {
  folder: string;
  frames: { file: string; at: number }[];
  seconds: number;
  /** True when it stopped itself rather than being stopped. */
  timedOut: boolean;
};

export type BackendStartupFailureReason =
  | 'backend_incompatible_runtime'
  | 'backend_incomplete_installation'
  | 'backend_package_architecture_mismatch'
  | 'backend_data_migration_failed'
  | 'backend_local_data_repair_failed'
  | 'backend_recoverable_database_corruption'
  | 'backend_transient_concurrent_startup'
  | 'backend_startup_directory_unavailable'
  | 'backend_startup_failed';

export type BackendIncompleteInstallationKind = 'missing_backend_binary' | 'missing_directory_resources';
export type BackendLocalDataIssueKind = 'agent_metadata_invalid_utf8' | 'assistant_storage_bootstrap_failed';
export type BackendStartupDirectoryIssueKind = 'missing_or_unavailable_directory' | 'permission_denied';

export interface BackendStartupFailureInfo {
  incompleteInstallationKind?: BackendIncompleteInstallationKind;
  localDataIssueKind?: BackendLocalDataIssueKind;
  startupDirectoryIssueKind?: BackendStartupDirectoryIssueKind;
  missingBackendBinary?: boolean;
  missingBundledFoolcoreDir?: boolean;
  missingHubDir?: boolean;
  missingPetStatesDir?: boolean;
  missingPwaDir?: boolean;
  reason: BackendStartupFailureReason;
  backendBoundaryCode?: string;
  backendBoundaryStage?: string;
  runtime?: 'glibc';
  requiredVersions?: string[];
  missingResources?: string[];
  missingRuntimeDir?: boolean;
  packageArch?: string;
  deviceArch?: string;
  expectedDownloadArch?: string;
  isRosettaTranslated?: boolean;
}

declare global {
  interface Window {
    electronAPI?: ElectronBridgeAPI;
    __initialLanguage?: string | null;
    __foolE2ETest?: boolean;
    __backendStartupFailed?: boolean;
    __backendStartupFailure?: BackendStartupFailureInfo | null;
    __installationIntegrityReportCount?: number;
    __lastInstallationIntegrityReportMessage?: string;
  }
}
