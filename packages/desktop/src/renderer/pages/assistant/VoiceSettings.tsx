/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react'
import { Card, Switch, Select, Slider, Space, Checkbox, Typography } from '@arco-design/web-react'
import { CheckCircleOutlined, ClockCircleOutlined } from '@icon-park/react'

const { Text } = Typography

/**
 * Voice assistant settings page
 */
export default function VoiceSettingsPage() {
  const [settings, setSettings] = useState({
    wakeWord: 'fool',
    autoListen: false,
    listeningTimeout: 30000,
    ttsEngine: 'piper-en-libritts-r',
    sttEngine: 'whisper-turbo',
    voiceGender: 'female',
    volume: 80,
    recordingVolume: 75,
    latencyMode: 'balanced',
  })

  const [voiceOptions] = useState([
    { value: 'piper-en-libritts-r', label: 'Piper (Fast, ~82ms/sentence)' },
    { value: 'kitten-v1-small', label: 'Kitten Small (~50MB)' },
    { value: 'kokoro-common_voice-v3', label: 'Koko (Natural tone)' },
    { value: 'pocket-english-large', label: 'Pocket TTS Large' },
    { value: 'zipvoice-base', label: 'ZipVoice Base' },
  ])

  const [sttOptions] = useState([
    { value: 'whisper-turbo', label: 'Whisper Turbo (Fast, ~93 tokens/s)' },
    { value: 'whisper-large-v3', label: 'Whisper Large-v3 (Accurate, ~40 tokens/s)' },
  ])

  return (
    <div className="p-4 space-y-6">
      {/* Voice Assistant Header */}
      <div className="space-y-2">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CheckCircleOutlined theme="filled" size="24" />
          Voice Assistant Settings
        </h1>
        <p className="text-gray-600">
          Configure speech recognition and synthesis settings for The Fool AI voice assistant.
        </p>
      </div>

      {/* Main Settings Card */}
      <Card title="Wake Word & Activation" style={{ width: '100%' }}>
        <Space direction="vertical" size="M" className="w-full">
          {/* Wake Word Setting */}
          <div className="space-y-2">
            <Text strong>Wake Word:</Text>
            <Select
              value={settings.wakeWord}
              options={[
                { value: 'fool', label: 'FOOL (default)' },
                { value: 'hey', label: 'Hey Fool' },
                { value: 'assistant', label: 'Assistant' },
              ]}
              onChange={(val) => setSettings((s) => ({ ...s, wakeWord: val }))}
            />
            <Text type="secondary" className="text-xs">
              Say this word to activate voice mode. Use a quiet environment for best results.
            </Text>
          </div>

          {/* Auto Listen Setting */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Text strong>Auto-Listen Mode:</Text>
              <Switch
                checked={settings.autoListen}
                onChange={(val) => setSettings((s) => ({ ...s, autoListen: val }))}
              />
            </div>
            <Text type="secondary" className="text-xs">
              Automatically listen when wake word is detected (no need to manually open voice mode).
            </Text>
          </div>

          {/* Listening Timeout */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Text strong>Listening Timeout:</Text>
              <Slider
                value={settings.listeningTimeout / 1000}
                min="5"
                max="60"
                step="5"
                tooltip={{ formatter: (v) => `${v}s` }}
                onChange={(val) => setSettings((s) => ({ ...s, listeningTimeout: val * 1000 }))}
              />
            </div>
            <Text type="secondary" className="text-xs">
              Stop listening after {settings.listeningTimeout / 1000}s of silence.
            </Text>
          </div>

          {/* Latency Mode */}
          <div className="space-y-2">
            <Select
              value={settings.latencyMode}
              options={[
                { value: 'fast', label: 'Fast (lowest latency, slightly lower accuracy)' },
                { value: 'balanced', label: 'Balanced (recommended)' },
                { value: 'accurate', label: 'Accurate (higher latency, best accuracy)' },
              ]}
              onChange={(val) => setSettings((s) => ({ ...s, latencyMode: val }))}
            />
          </div>

          {/* Quick Tips */}
          <Card title="💡 Quick Tips" style={{ marginTop: '16px' }}>
            <Space direction="vertical" size="M">
              <p className="text-sm text-gray-600">
                🎤 Use a high-quality microphone for best voice recognition accuracy.
              </p>
              <p className="text-sm text-gray-600">
                🌍 Whisper Turbo supports 98 languages and 13 sound categories.
              </p>
              <p className="text-sm text-gray-600">
                ⚡ Piper TTS delivers ~82ms per sentence (fastest option).
              </p>
            </Space>
          </Card>
        </Space>
      </Card>

      {/* Text-to-Speech Settings */}
      <Card title="Text-to-Speech (TTS)" style={{ width: '100%' }}>
        <Space direction="vertical" size="M" className="w-full">
          {/* TTS Engine Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Text strong>TTS Engine:</Text>
              <Select
                value={settings.ttsEngine}
                options={voiceOptions}
                onChange={(val) => setSettings((s) => ({ ...s, ttsEngine: val }))}
              />
            </div>

            {/* Voice Gender */}
            <div className="space-y-2">
              <Text strong>Voice Gender:</Text>
              <Select
                value={settings.voiceGender}
                options={[
                  { value: 'female', label: 'Female (natural, ~200Hz)' },
                  { value: 'male', label: 'Male (natural, ~120Hz)' },
                  { value: 'neutral', label: 'Neutral' },
                ]}
                onChange={(val) => setSettings((s) => ({ ...s, voiceGender: val }))}
              />
            </div>

            {/* Volume */}
            <div className="space-y-2">
              <Text strong>Output Volume:</Text>
              <Slider
                value={settings.volume}
                min="0"
                max="100"
                step="5"
                tooltip={{ formatter: (v) => `${v}%` }}
                onChange={(val) => setSettings((s) => ({ ...s, volume: val }))}
              />
            </div>

            {/* TTS Quick Stats */}
            <Card title={
              <div className="flex items-center gap-2">
                <ClockCircleOutlined theme="filled" size="18" />
                Engine Statistics
              </div>
            } style={{ marginTop: '16px' }}>
              <Space direction="vertical" size="M">
                {settings.ttsEngine === 'piper-en-libritts-r' && (
                  <>
                    <p className="text-sm text-gray-600">
                      ⚡ Speed: ~82ms per sentence (Piper fastest option)
                    </p>
                    <p className="text-sm text-gray-600">
                      🎯 Quality: High (pre-trained on LibriTTS corpus)
                    </p>
                    <p className="text-sm text-gray-600">
                      💾 Model Size: ~180MB (very efficient)
                    </p>
                  </>
                )}

                {settings.ttsEngine === 'kokoro-common_voice-v3' && (
                  <>
                    <p className="text-sm text-gray-600">
                      🎯 Quality: Very high (natural intonation, ~50ms/sentence)
                    </p>
                    <p className="text-sm text-gray-600">
                      🗣️ Voices: 20+ pre-trained voices available
                    </p>
                    <p className="text-sm text-gray-600">
                      💾 Model Size: ~500MB
                    </p>
                  </>
                )}

                {settings.ttsEngine === 'kitten-v1-small' && (
                  <>
                    <p className="text-sm text-gray-600">
                      📦 Size: ~50MB (smallest model)
                    </p>
                    <p className="text-sm text-gray-600">
                      ⚡ Speed: Fast (~120ms/sentence on average CPU)
                    </p>
                    <p className="text-sm text-gray-600">
                      🎯 Quality: Good (basic but functional)
                    </p>
                  </>
                )}
              </Space>
            </Card>
          </div>
        </Space>
      </Card>

      {/* Speech-to-Text Settings */}
      <Card title="Speech-to-Text (STT)" style={{ width: '100%' }}>
        <Space direction="vertical" size="M" className="w-full">
          {/* STT Engine Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Text strong>STT Engine:</Text>
              <Select
                value={settings.sttEngine}
                options={sttOptions}
                onChange={(val) => setSettings((s) => ({ ...s, sttEngine: val }))}
              />
            </div>

            {/* STT Quick Stats */}
            <Card title={
              <div className="flex items-center gap-2">
                <ClockCircleOutlined theme="filled" size="18" />
                Engine Statistics
              </div>
            } style={{ marginTop: '16px' }}>
              <Space direction="vertical" size="M">
                {settings.sttEngine === 'whisper-turbo' && (
                  <>
                    <p className="text-sm text-gray-600">
                      ⚡ Speed: ~93 tokens/second (fastest option)
                    </p>
                    <p className="text-sm text-gray-600">
                      🌍 Languages: 98 supported
                    </p>
                    <p className="text-sm text-gray-600">
                      🔊 Categories: 13 sound types (whistle, dog barking, etc.)
                    </p>
                    <p className="text-sm text-gray-600">
                      💾 Model Size: ~750MB (smaller than Large)
                    </p>
                  </>
                )}

                {settings.sttEngine === 'whisper-large-v3' && (
                  <>
                    <p className="text-sm text-gray-600">
                      🎯 Accuracy: Highest quality (recommended for accuracy)
                    </p>
                    <p className="text-sm text-gray-600">
                      ⚡ Speed: ~40 tokens/second (slower but more accurate)
                    </p>
                    <p className="text-sm text-gray-600">
                      🔊 Categories: 13 sound types
                    </p>
                    <p className="text-sm text-gray-600">
                      💾 Model Size: ~2.5GB (largest model)
                    </p>
                  </>
                )}
              </Space>
            </Card>

            {/* STT Advanced Options */}
            <div className="space-y-2 pt-4">
              <Text strong>Language:</Text>
              <Select
                value={settings.language || 'en'}
                options={[
                  { value: 'en', label: 'English' },
                  { value: 'es', label: 'Spanish' },
                  { value: 'fr', label: 'French' },
                  { value: 'de', label: 'German' },
                  { value: 'zh', label: 'Chinese' },
                  { value: 'ja', label: 'Japanese' },
                ]}
              />

              <Checkbox.Group>
                <div className="grid grid-cols-2 gap-4">
                  <Checkbox checked value="timestamp">Show timestamps</Checkbox>
                  <Checkbox checked value="case_sensitive">Case-sensitive output</Checkbox>
                </div>
              </Checkbox.Group>
            </div>
          </div>
        </Space>
      </Card>

      {/* Recording Settings */}
      <Card title="Recording Settings" style={{ width: '100%' }}>
        <Space direction="vertical" size="M" className="w-full">
          <div className="space-y-2">
            <Text strong>Microphone Volume:</Text>
            <Slider
              value={settings.recordingVolume}
              min="50"
              max="100"
              step="5"
              tooltip={{ formatter: (v) => `${v}%` }}
              onChange={(val) => setSettings((s) => ({ ...s, recordingVolume: val }))}
            />

            <div className="grid grid-cols-2 gap-4 pt-4">
              <Checkbox checked>Microphone monitoring</Checkbox>
              <Checkbox checked>Mute other apps during recording</Checkbox>
            </div>

            <Text type="secondary" className="text-xs">
              Higher volume increases sensitivity. Adjust if voice is too quiet or overwhelming.
            </Text>
          </div>
        </Space>
      </Card>
    </div>
  )
}
