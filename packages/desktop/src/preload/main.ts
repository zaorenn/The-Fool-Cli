/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Hook Sentry IPC so the renderer SDK uses ipcRenderer.send instead of falling
// back to fetch('sentry-ipc://...'), which floods the DevTools Network panel.
// Bundled into this preload via `externalizeDepsPlugin({ exclude: [...] })` so
// Electron's sandbox-mode preload doesn't try to resolve it from node_modules.
import '@sentry/electron/preload';
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { ADAPTER_BRIDGE_EVENT_KEY } from '../common/adapter/constant';

/**
 * @description 注入到renderer进程中, 用于与main进程通信
 * */
contextBridge.exposeInMainWorld('electronAPI', {
  emit: (name: string, data: unknown) => {
    return ipcRenderer
      .invoke(
        ADAPTER_BRIDGE_EVENT_KEY,
        JSON.stringify({
          name: name,
          data: data,
        })
      )
      .catch((error) => {
        console.error('IPC invoke error:', error);
        throw error;
      });
  },
  on: (callback: (payload: { event: unknown; value: unknown }) => void) => {
    const handler = (event: unknown, value: unknown) => {
      callback({ event, value });
    };
    ipcRenderer.on(ADAPTER_BRIDGE_EVENT_KEY, handler);
    return () => {
      ipcRenderer.off(ADAPTER_BRIDGE_EVENT_KEY, handler);
    };
  },
  // 获取拖拽文件/目录的绝对路径 / Get absolute path for dragged file/directory
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  // Feedback: collect and compress recent log files
  collectFeedbackLogs: () => ipcRenderer.invoke('feedback:collect-logs'),
  // Feedback: capture a screenshot of the current window
  captureFeedbackScreenshot: () => ipcRenderer.invoke('feedback:capture-screenshot'),
  // The display the pointer is on, and a region of it the user draws
  captureScreen: () => ipcRenderer.invoke('voice:capture-screen'),
  captureScreenRegion: () => ipcRenderer.invoke('voice:capture-screen-region'),
  captureWindow: (match: string) => ipcRenderer.invoke('voice:capture-window', { match }),
  // Where a spoken "build me an app" puts what it builds, and how to look at it
  previewWorkspaceRoot: () => ipcRenderer.invoke('preview:workspace-root'),
  servePreview: (directory: string) => ipcRenderer.invoke('preview:serve', directory),
  stopPreview: () => ipcRenderer.invoke('preview:stop'),
  // Being shown how to do something, and writing it up as a skill
  startSkillRecording: (name: string) => ipcRenderer.invoke('skill:record-start', name),
  stopSkillRecording: () => ipcRenderer.invoke('skill:record-stop'),
  cancelSkillRecording: () => ipcRenderer.invoke('skill:record-cancel'),
  prepareSkillFolder: (name: string) => ipcRenderer.invoke('skill:prepare-folder', name),
  writeSkillDraft: (folder: string, body: string) => ipcRenderer.invoke('skill:write-draft', folder, body),
  // A workspace's own page: served over loopback with the bridge in it
  serveWorkspaceApp: (folder: string, entry: string) => ipcRenderer.invoke('workspace-app:serve', folder, entry),
  stopWorkspaceApp: () => ipcRenderer.invoke('workspace-app:stop'),
  prepareWorkspaceApp: (folder: string) => ipcRenderer.invoke('workspace-app:prepare', folder),
  readWorkspaceApp: (folder: string) => ipcRenderer.invoke('workspace-app:read', folder),
  writeWorkspaceApp: (folder: string, files: Record<string, string>) =>
    ipcRenderer.invoke('workspace-app:write', folder, files),
  removeWorkspaceApp: (folder: string) => ipcRenderer.invoke('workspace-app:remove', folder),
  // Feedback: forward diagnostics logs to the main process console
  logFeedbackEvent: (payload: { details?: unknown; level: 'info' | 'warn' | 'error'; message: string }) =>
    ipcRenderer.send('feedback:renderer-log', payload),
  recoverCorruptedDatabase: () => ipcRenderer.invoke('backend:recover-corrupted-database'),
});

// Synchronously fetch the foolcore port and expose it to the renderer
// via contextBridge (direct window assignment is invisible under contextIsolation).
const backendPort = ipcRenderer.sendSync('get-backend-port') as number;
const initialLanguage = ipcRenderer.sendSync('get-initial-language') as string | null;
const backendStartupFailed = ipcRenderer.sendSync('get-backend-startup-failed') as boolean;
const backendStartupFailure = ipcRenderer.sendSync('get-backend-startup-failure') as unknown;
const bootstrapSecret = ipcRenderer.sendSync('get-bootstrap-secret') as string;
contextBridge.exposeInMainWorld('__backendPort', backendPort > 0 ? backendPort : 0);
contextBridge.exposeInMainWorld('__bootstrapSecret', bootstrapSecret || null);
contextBridge.exposeInMainWorld('__initialLanguage', initialLanguage ?? null);
contextBridge.exposeInMainWorld('__foolE2ETest', process.env.FOOL_E2E_TEST === '1');
contextBridge.exposeInMainWorld('__backendStartupFailed', backendStartupFailed === true);
contextBridge.exposeInMainWorld('__backendStartupFailure', backendStartupFailure ?? null);

// Backend startup state bridge: `getState` re-reads the current failure info on
// mount (resolves the "READY arrived before the renderer subscribed" race), and
// `subscribe` receives subsequent ready/exit pushes on the backend-startup-state
// channel. All communication stays behind the preload contextBridge.
contextBridge.exposeInMainWorld('__backendStartupBridge', {
  getState: () => ipcRenderer.sendSync('get-backend-startup-failure'),
  subscribe: (callback: (state: unknown) => void) => {
    const handler = (_event: unknown, value: unknown) => callback(value);
    ipcRenderer.on('backend-startup-state', handler);
    return () => {
      ipcRenderer.off('backend-startup-state', handler);
    };
  },
});

// 托盘事件监听 - 将 IPC 事件转换为 DOM 事件
// Tray event listeners - convert IPC events to DOM events
const trayEvents = [
  'tray:navigate-to-guid',
  'tray:navigate-to-conversation',
  'tray:open-about',
  'tray:pause-all-tasks',
  'tray:check-update',
  'tray:toggle-wake-listening',
  'tray:reset-theme',
];

for (const channel of trayEvents) {
  ipcRenderer.on(channel, (_event, ...args) => {
    window.dispatchEvent(new CustomEvent(channel, { detail: args[0] }));
  });
}
