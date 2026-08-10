/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { contextBridge, ipcRenderer } from 'electron'
import type { IVoiceAPI, VoiceState, TranscriptionResult, TTSResult, VoiceStats, EnginePerformance } from '../common/types/voice'

/**
 * IPC Bridge for voice/stt/tts functionality
 */
const voiceAPI: IVoiceAPI = {
  /** Initialize STT engine */
  async initSTT(engine: 'whisper-turbo' | 'whisper-large-v3'): Promise<void> {
    try {
      await ipcRenderer.invoke('voice:init-stt', { engine })
      console.log(`[Voice] STT initialized with engine: ${engine}`)
    } catch (error) {
      console.error('[Voice] Failed to init STT:', error)
      throw error
    }
  },

  /** Initialize TTS engine */
  async initTTS(engine: string): Promise<void> {
    try {
      await ipcRenderer.invoke('voice:init-tts', { engine })
      console.log(`[Voice] TTS initialized with engine: ${engine}`)
    } catch (error) {
      console.error('[Voice] Failed to init TTS:', error)
      throw error
    }
  },

  /** Get current voice state */
  getState(): VoiceState {
    try {
      return ipcRenderer.invoke('voice:get-state') as VoiceState
    } catch (error) {
      console.error('[Voice] Failed to get state:', error)
      return {
        isListening: false,
        isSpeaking: false,
        sttEngine: null,
        ttsEngine: null,
        wakeWord: null,
        volume: 100,
        latencyMode: 'balanced',
        processingQueueSize: 0,
      }
    }
  },

  /** Start listening for speech */
  async startListening(options?: { autoStartTTS?: boolean }): Promise<TranscriptionResult> {
    try {
      const result = await ipcRenderer.invoke('voice:start-listening', options) as TranscriptionResult
      console.log('[Voice] Started listening')
      return result
    } catch (error) {
      console.error('[Voice] Failed to start listening:', error)
      throw error
    }
  },

  /** Stop listening */
  async stopListening(): Promise<void> {
    try {
      await ipcRenderer.invoke('voice:stop-listening')
      console.log('[Voice] Stopped listening')
    } catch (error) {
      console.error('[Voice] Failed to stop listening:', error)
      throw error
    }
  },

  /** Generate speech from text */
  async speak(text: string, config?: TTSConfig): Promise<TTSResult> {
    try {
      const result = await ipcRenderer.invoke('voice:speak', { text, config }) as TTSResult
      console.log('[Voice] Started speaking')
      return result
    } catch (error) {
      console.error('[Voice] Failed to speak:', error)
      throw error
    }
  },

  /** Cancel current speech generation */
  async cancelSpeech(): Promise<void> {
    try {
      await ipcRenderer.invoke('voice:cancel-speech')
      console.log('[Voice] Cancelled speech')
    } catch (error) {
      console.error('[Voice] Failed to cancel speech:', error)
      throw error
    }
  },

  /** Check if STT is initialized */
  isSTTInitialized(): boolean {
    try {
      return ipcRenderer.invoke('voice:is-stt-initialized') as boolean
    } catch (error) {
      console.error('[Voice] Failed to check STT status:', error)
      return false
    }
  },

  /** Check if TTS is initialized */
  isTTSInitialized(): boolean {
    try {
      return ipcRenderer.invoke('voice:is-tts-initialized') as boolean
    } catch (error) {
      console.error('[Voice] Failed to check TTS status:', error)
      return false
    }
  },

  /** Get supported STT engines */
  getSupportedSTTEngines(): string[] {
    try {
      return ipcRenderer.invoke('voice:get-supported-stt-engines') as string[]
    } catch (error) {
      console.error('[Voice] Failed to get supported STT engines:', error)
      return ['whisper-turbo', 'whisper-large-v3']
    }
  },

  /** Get supported TTS engines */
  getSupportedTTSEngines(): string[] {
    try {
      return ipcRenderer.invoke('voice:get-supported-tts-engines') as string[]
    } catch (error) {
      console.error('[Voice] Failed to get supported TTS engines:', error)
      return ['piper-en-libritts-r', 'kokoro-common_voice-v3', 'kitten-v1-small']
    }
  },

  /** Load custom wake word model */
  async loadWakeWordModel(modelPath?: string): Promise<void> {
    try {
      await ipcRenderer.invoke('voice:load-wake-word-model', { modelPath })
      console.log('[Voice] Loaded wake word model')
    } catch (error) {
      console.error('[Voice] Failed to load wake word model:', error)
      throw error
    }
  },

  /** Configure voice settings */
  async configure(config: {
    sttEngine?: string
    ttsEngine?: string
    wakeWord?: string
    volume?: number
    speed?: number
  }): Promise<void> {
    try {
      await ipcRenderer.invoke('voice:configure', config)
      console.log('[Voice] Voice settings configured')
    } catch (error) {
      console.error('[Voice] Failed to configure voice:', error)
      throw error
    }
  },

  /** Listen for voice state changes */
  onVoiceStateChange(callback: (state: VoiceState) => void): () => void {
    try {
      const subscription = ipcRenderer.on('voice-state-changed', (_event, state: VoiceState) => {
        callback(state)
      })
      
      return () => {
        ipcRenderer.removeListener('voice-state-changed', subscription)
      }
    } catch (error) {
      console.error('[Voice] Failed to setup voice state listener:', error)
      return () => {}
    }
  },

  /** Load custom TTS model from file */
  async loadTTSPreset(presetPath: string): Promise<void> {
    try {
      await ipcRenderer.invoke('voice:load-tts-preset', { presetPath })
      console.log('[Voice] Loaded TTS preset')
    } catch (error) {
      console.error('[Voice] Failed to load TTS preset:', error)
      throw error
    }
  },
}

/**
 * Export voice API for renderer process
 */
contextBridge.exposeInMainWorld('foolVoice', voiceAPI)

console.log('[IPC Bridge] Voice API exposed to renderer')
