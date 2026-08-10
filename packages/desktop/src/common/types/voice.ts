/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EventEmitter } from 'eventemitter3'

/**
 * Speech Recognition Configuration Options
 */
export interface STTConfig {
  /** STT engine to use (whisper-turbo, whisper-large-v3) */
  engine: 'whisper-turbo' | 'whisper-large-v3'

  /** Language code for transcription */
  language?: string

  /** Whether to detect language automatically */
  detectLanguage?: boolean

  /** Maximum number of alternative transcriptions */
  beamSize?: number

  /** Sample rate in Hz (default: 16000) */
  sampleRate?: number

  /** Whether to return timestamps with transcription */
  includeTimestamps?: boolean
}

/**
 * STT Transcription Result
 */
export interface TranscriptionResult {
  /** Full transcription text */
  text: string

  /** Language code detected */
  language: string

  /** Timestamp when transcription completed */
  timestamp: number

  /** Duration in seconds */
  duration: number

  /** Confidence score (0.0 - 1.0) */
  confidence: number

  /** Individual segments with timestamps */
  segments: TranscriptionSegment[]

  /** Error messages if any */
  errors?: string[]
}

/**
 * Transcription segment
 */
export interface TranscriptionSegment {
  /** Start time in seconds */
  start: number

  /** End time in seconds */
  end: number

  /** Text of this segment */
  text: string

  /** Language for this segment */
  language?: string

  /** Confidence for this segment */
  confidence?: number
}

/**
 * Voice State (current status)
 */
export interface VoiceState {
  /** Is currently listening? */
  isListening: boolean

  /** Is currently speaking? */
  isSpeaking: boolean

  /** Current STT engine */
  sttEngine: string | null

  /** Current TTS engine */
  ttsEngine: string | null

  /** Wake word being used */
  wakeWord: string | null

  /** Current volume level */
  volume: number

  /** Latency mode (fast/balanced/accurate) */
  latencyMode: 'fast' | 'balanced' | 'accurate'

  /** Processing queue size */
  processingQueueSize: number
}

/**
 * Text-to-Speech Configuration Options
 */
export interface TTSConfig {
  /** TTS engine to use (piper, kokoro, kitten, pocket, zipvoice) */
  engine: 'piper-en-libritts-r' | 'kokoro-common_voice-v3' | 'kitten-v1-small' | 'pocket-english-large' | 'zipvoice-base'

  /** Voice gender (male/female/neutral) */
  gender?: 'male' | 'female' | 'neutral'

  /** Speech speed (0.2 - 4.0, default: 1.0) */
  speed?: number

  /** Output volume (0.0 - 1.0) */
  volume?: number

  /** Pitch shift (-2 to 2) */
  pitch?: number

  /** Whether to use high-quality audio */
  highQuality?: boolean
}

/**
 * TTS Result
 */
export interface TTSResult {
  /** Generated speech text */
  text: string

  /** Duration in seconds */
  duration: number

  /** Speech speed used */
  speed: number

  /** Volume level used */
  volume: number

  /** Audio format */
  format: string

  /** Sample rate */
  sampleRate: number

  /** Bites generated */
  bites: string[]
}

/**
 * Voice API Interface for IPC Bridge
 */
export interface IVoiceAPI {
  /** Initialize voice system with STT/TTS engines */
  initSTT(engine: 'whisper-turbo' | 'whisper-large-v3'): Promise<void>

  /** Initialize TTS engine */
  initTTS(engine: string): Promise<void>

  /** Get current voice state */
  getState(): VoiceState

  /** Start listening for speech */
  startListening(options?: { autoStartTTS?: boolean }): Promise<TranscriptionResult>

  /** Stop listening */
  stopListening(): Promise<void>

  /** Generate speech from text */
  speak(text: string, config?: TTSConfig): Promise<TTSResult>

  /** Cancel current speech generation */
  cancelSpeech(): Promise<void>

  /** Check if STT is initialized */
  isSTTInitialized(): boolean

  /** Check if TTS is initialized */
  isTTSInitialized(): boolean

  /** Get supported STT engines */
  getSupportedSTTEngines(): string[]

  /** Get supported TTS engines */
  getSupportedTTSEngines(): string[]

  /** Load custom wake word model */
  loadWakeWordModel(modelPath?: string): Promise<void>

  /** Configure voice settings */
  configure(config: {
    sttEngine?: string
    ttsEngine?: string
    wakeWord?: string
    volume?: number
    speed?: number
  }): Promise<void>

  /** Listen for voice state changes */
  onVoiceStateChange(callback: (state: VoiceState) => void): () => void

  /** Load custom TTS model from file */
  loadTTSPreset(presetPath: string): Promise<void>
}

/**
 * Voice Event Emitter Types
 */
export type VoiceEventEmitter = EventEmitter<VoiceEvents>

export interface VoiceEvents {
  /** Fired when STT is initialized successfully */
  sttInitialized: () => void

  /** Fired when TTS is initialized successfully */
  ttsInitialized: () => void

  /** Fired when voice state changes */
  voiceStateChanged: (state: VoiceState) => void

  /** Fired when transcription segment is received */
  segmentReceived: (segment: TranscriptionSegment) => void

  /** Fired when transcription completes */
  transcriptionComplete: (result: TranscriptionResult) => void

  /** Fired when speech starts playing */
  speakingStarted: () => void

  /** Fired when speech ends playing */
  speakingEnded: () => void

  /** Fired on error */
  onError: (error: Error) => void
}

/**
 * Voice engine statistics
 */
export interface VoiceStats {
  /** Total STT tokens processed */
  sttTokensProcessed: number

  /** Total TTS bytes generated */
  ttsBytesGenerated: number

  /** Average STT latency in ms */
  averageSTTLatency: number

  /** Average TTS latency in ms */
  averageTTSLatency: number

  /** Current memory usage for voice system */
  memoryUsageMB: number

  /** Number of successful transcriptions */
  transcriptionCount: number

  /** Number of successful speech generations */
  speechGenerationCount: number
}

/**
 * Voice engine performance metrics
 */
export interface EnginePerformance {
  /** STT engine name and stats */
  sttEngine: {
    name: string
    tokensPerSecond: number
    accuracyScore: number
    memoryUsageMB: number
  }

  /** TTS engine name and stats */
  ttsEngine: {
    name: string
    msPerSentence: number
    qualityScore: number
    memoryUsageMB: number
  }
}
