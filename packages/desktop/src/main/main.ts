/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import process from 'process'
import VoiceEngine from '../process/voice/voiceStageHub'

/**
 * Main entry point for The Fool desktop application
 */

let mainWindow: BrowserWindow | null = null
let voiceEngine: VoiceEngine | null = null

/**
 * Create main window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.ts'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#ffffff',
    show: false,
  })

  // Load the app
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools()
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  // Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  console.log('[Main] Window created')
}

/**
 * Initialize voice engine and IPC handlers
 */
async function initializeVoiceSystem() {
  try {
    voiceEngine = new VoiceEngine()

    // Initialize STT with whisper turbo for fast responses
    await voiceEngine.initSTT('whisper-turbo')

    console.log('[Main] Voice engine initialized')
  } catch (error) {
    console.error('[Main] Failed to initialize voice system:', error)
  }
}

/**
 * Setup IPC handlers
 */
function setupIPC() {
  // File operations
  ipcMain.handle('read-file', async (_event, filePath: string): Promise<string | null> => {
    try {
      const content = await require('fs').promises.readFile(filePath, 'utf-8')
      return content
    } catch (error) {
      console.error('[IPC] Failed to read file:', error)
      throw new Error('File not found or cannot be read', { cause: error })
    }
  })

  ipcMain.handle('write-file', async (_event, filePath: string, content: string): Promise<void> => {
    const dir = path.dirname(filePath)
    await require('fs').promises.mkdir(dir, { recursive: true })
    await require('fs').promises.writeFile(filePath, content, 'utf-8')
  })

  ipcMain.handle('readdir', async (_event, dirPath: string): Promise<string[]> => {
    const files = await require('fs').promises.readdir(dirPath, { withFileTypes: true })
    return files.map((file) => file.name)
  })

  // Window operations
  ipcMain.handle('get-window-size', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender!.webContents)
    if (window) {
      return {
        width: window.getBounds().width,
        height: window.getBounds().height,
      }
    }
    return { width: 0, height: 0 }
  })

  ipcMain.handle('set-window-size', async (_event, { width, height }): Promise<void> => {
    const window = BrowserWindow.fromWebContents((_event.sender as any)!.webContents)
    if (window) {
      window.setSize(width, height)
    }
  })

  // Voice engine handlers
  ipcMain.handle('voice:init-stt', async (_event, { engine }: { engine: string }): Promise<void> => {
    console.log('[IPC] Initializing STT with engine:', engine)
    
    if (voiceEngine) {
      await voiceEngine.initSTT(engine)
      mainWindow?.webContents.send('voice:stt-initialized', true)
    }
  })

  ipcMain.handle('voice:init-tts', async (_event, { engine }: { engine: string }): Promise<void> => {
    console.log('[IPC] Initializing TTS with engine:', engine)
    
    if (voiceEngine) {
      await voiceEngine.initTTS(engine)
      mainWindow?.webContents.send('voice:tts-initialized', true)
    }
  })

  ipcMain.handle('voice:get-state', async (): Promise<any> => {
    return voiceEngine?.getState() || {}
  })

  ipcMain.handle('voice:start-listening', async (_event, options?: any): Promise<any> => {
    console.log('[IPC] Starting STT listening')
    
    if (voiceEngine) {
      await voiceEngine.startListening()
      
      // Listen for transcription events
      voiceEngine.onTranscription((result: any) => {
        mainWindow?.webContents.send('voice:transcription', result)
      })

      return { success: true }
    }
    
    throw new Error('Voice engine not initialized')
  })

  ipcMain.handle('voice:stop-listening', async (): Promise<void> => {
    console.log('[IPC] Stopped STT listening')
    
    if (voiceEngine) {
      await voiceEngine.stopListening()
      mainWindow?.webContents.send('voice:stopped-listening', true)
    }
  })

  ipcMain.handle('voice:speak', async (_event, { text }: { text: string }): Promise<any> => {
    console.log('[IPC] Starting TTS speaking')
    
    if (voiceEngine) {
      await voiceEngine.speak(text)
      
      // Listen for speech events
      voiceEngine.onSpeaking(() => {
        mainWindow?.webContents.send('voice:speaking', true)
      })

      voiceEngine.onSpeakEnd(() => {
        mainWindow?.webContents.send('voice:speak-end', true)
      })

      return { success: true }
    }
    
    throw new Error('Voice engine not initialized')
  })

  ipcMain.handle('voice:is-stt-initialized', async (): Promise<boolean> => {
    return voiceEngine?.isSTTInitialized() ?? false
  })

  ipcMain.handle('voice:is-tts-initialized', async (): Promise<boolean> => {
    return voiceEngine?.isTTSInitialized() ?? false
  })

  ipcMain.handle('voice:get-supported-stt-engines', async (): Promise<string[]> => {
    return ['whisper-turbo', 'whisper-large-v3']
  })

  ipcMain.handle('voice:get-supported-tts-engines', async (): Promise<string[]> => {
    return [
      'piper-en-libritts-r',
      'kokoro-common_voice-v3',
      'kitten-v1-small',
      'pocket-english-large',
      'zipvoice-base',
    ]
  })

  console.log('[IPC] Voice handlers registered')
}

/**
 * App lifecycle events
 */
app.whenReady().then(async () => {
  // Initialize voice system
  await initializeVoiceSystem()

  // Setup IPC handlers
  setupIPC()

  // Create main window
  createWindow()

  // Register global shortcuts
  app.on('browser-window-blur', () => {
    console.log('[Main] Window lost focus')
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  // On macOS it is common to create multiple windows
  // Keep the app running if it's a dock icon application
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Cleanup on exit
app.on('will-quit', () => {
  voiceEngine?.dispose?.()
})

console.log('[Main] The Fool desktop app starting...')
