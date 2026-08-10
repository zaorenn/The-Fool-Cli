/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { contextBridge, ipcRenderer } from 'electron'

/**
 * Expose IPC API to renderer process via contextBridge
 */
const preloadAPI = {
  // File operations
  readFile: (_event: any, filePath: string): Promise<string | null> => 
    ipcRenderer.invoke('read-file', filePath),
  
  writeFile: (_event: any, filePath: string, content: string): Promise<void> =>
    ipcRenderer.invoke('write-file', filePath, content),
  
  readdir: (_event: any, dirPath: string): Promise<string[]> =>
    ipcRenderer.invoke('readdir', dirPath),
  
  stat: (_event: any, filePath: string): Promise<any> =>
    ipcRenderer.invoke('stat', filePath),
  
  exists: (_event: any, filePath: string): Promise<boolean> =>
    ipcRenderer.invoke('file-exists', filePath),
  
  readFiles: (_event: any, filePaths: string[]): Promise<{ path: string; content: string | null }[]> =>
    ipcRenderer.invoke('read-files', filePaths),
  
  writeFiles: (_event: any, files: { path: string; content: string }[]): Promise<void> =>
    ipcRenderer.invoke('write-files', files),
  
  delete: (_event: any, filePath: string): Promise<void> =>
    ipcRenderer.invoke('delete', filePath),

  // Window operations
  getWindowSize: (): Promise<{ width: number; height: number }> =>
    ipcRenderer.invoke('get-window-size'),
  
  setWindowSize: (width: number, height: number): Promise<void> =>
    ipcRenderer.invoke('set-window-size', { width, height }),

  // Voice operations
  voice: {
    initSTT: async (_event: any, engine: 'whisper-turbo' | 'whisper-large-v3'): Promise<void> =>
      ipcRenderer.invoke('voice:init-stt', { engine }),
    
    initTTS: async (_event: any, engine: string): Promise<void> =>
      ipcRenderer.invoke('voice:init-tts', { engine }),
    
    getState: (): Promise<any> =>
      ipcRenderer.invoke('voice:get-state'),
    
    startListening: async (options?: any): Promise<any> =>
      ipcRenderer.invoke('voice:start-listening', options),
    
    stopListening: (): Promise<void> =>
      ipcRenderer.invoke('voice:stop-listening'),
    
    speak: async (_event: any, text: string): Promise<any> =>
      ipcRenderer.invoke('voice:speak', { text }),
    
    isSTTInitialized: (): Promise<boolean> =>
      ipcRenderer.invoke('voice:is-stt-initialized'),
    
    isTTSInitialized: (): Promise<boolean> =>
      ipcRenderer.invoke('voice:is-tts-initialized'),
    
    getSupportedSTTEngines: (): Promise<string[]> =>
      ipcRenderer.invoke('voice:get-supported-stt-engines'),
    
    getSupportedTTSEngines: (): Promise<string[]> =>
      ipcRenderer.invoke('voice:get-supported-tts-engines'),
  },

  // System info
  getSystemInfo: (): Promise<any> =>
    ipcRenderer.invoke('get-system-info'),

  // App version
  getVersion: (): Promise<string> =>
    ipcRenderer.invoke('get-version'),

  // IPC listeners (event-based)
  onVoiceStateChanged: (_event: any, callback: any): void => {
    ipcRenderer.on('voice-state-changed', (_event, state) => {
      if (typeof callback === 'function') callback(state)
    })
  },

  onTranscription: (_event: any, callback: any): void => {
    ipcRenderer.on('voice:transcription', (_event, result) => {
      if (typeof callback === 'function') callback(result)
    })
  },

  onSpeaking: (_event: any, callback: any): void => {
    ipcRenderer.on('voice:speaking', () => {
      if (typeof callback === 'function') callback()
    })
  },

  onSpeakEnd: (_event: any, callback: any): void => {
    ipcRenderer.on('voice:speak-end', () => {
      if (typeof callback === 'function') callback()
    })
  },

  // Window operations
  minimizeWindow: (): Promise<void> =>
    ipcRenderer.invoke('minimize-window'),
  
  maximizeWindow: (): Promise<void> =>
    ipcRenderer.invoke('maximize-window'),
  
  closeWindow: (): Promise<void> =>
    ipcRenderer.invoke('close-window'),
  
  reloadWindow: (): Promise<void> =>
    ipcRenderer.invoke('reload-window'),
  
  restartApp: (): Promise<void> =>
    ipcRenderer.invoke('restart-app'),
  
  quitApp: (): Promise<void> =>
    ipcRenderer.invoke('quit-app'),

  // Clipboard operations
  copyToClipboard: (_event: any, data: string | Buffer): Promise<boolean> =>
    ipcRenderer.invoke('copy-clipboard', data),
  
  readFromClipboard: (): Promise<string | null> =>
    ipcRenderer.invoke('read-clipboard'),
  
  clearClipboard: (): Promise<void> =>
    ipcRenderer.invoke('clear-clipboard'),

  // Shell operations
  openFolder: (_event: any, folderPath: string): Promise<void> =>
    ipcRenderer.invoke('open-folder', folderPath),

  // File dialogs
  openFileDialog: (): Promise<{ filePath: string } | null> =>
    ipcRenderer.invoke('open-file-dialog'),
  
  saveFileDialog: (_event: any, filePath?: string): Promise<{ filePath: string } | null> =>
    ipcRenderer.invoke('save-file-dialog', filePath),
}

/**
 * Export preload API for renderer process access
 */
contextBridge.exposeInMainWorld('fool', preloadAPI)

console.log('[Preload] IPC API exposed to renderer')
