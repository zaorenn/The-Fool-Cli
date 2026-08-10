/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useCallback } from 'react'
import { Card, Button, Space, Input, Typography, Progress, Empty, Tag } from '@arco-design/web-react'
import type { TranscriptionResult, TTSResult } from '@/common/types/voice'
import { PlayCircleOutlined, MicFilled, StopFilled, CheckCircleOutlined } from '@icon-park/react'

const { Text } = Typography

/**
 * Voice Assistant - Main STT/TTS interaction component
 */
export default function VoiceAssistantPage() {
  const [isListening, setIsListening] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [transcription, setTranscription] = useState<TranscriptionResult | null>(null)
  const [response, setResponse] = useState<TTSResult | null>(null)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState<'idle' | 'listening' | 'processing' | 'speaking' | 'complete'>('idle')

  const recordingRef = useRef<number | null>(null)

  /** Start listening to voice input */
  const handleStartListening = useCallback(async () => {
    try {
      // Initialize STT engine (Whisper Turbo for fast responses)
      if (!window.foolVoice?.sttInitialized) {
        await window.foolVoice?.initSTT('whisper-turbo')
      }

      setIsListening(true)
      setStatus('listening')
      setTranscription(null)
      setProgress(0)

      // Start recording simulation
      recordingRef.current = setInterval(() => {
        setProgress((prev) => {
          const next = prev + 1
          if (next >= 100) {
            stopListening()
            return 0
          }
          return next
        })
      }, 500)
    } catch (error) {
      console.error('Failed to start listening:', error)
      setIsListening(false)
    }
  }, [])

  /** Stop listening and process transcription */
  const stopListening = useCallback(async () => {
    if (recordingRef.current) {
      clearInterval(recordingRef.current)
      recordingRef.current = null
    }

    setIsListening(false)
    setStatus('processing')

    // Simulate processing delay
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Get transcription (in real app, this would come from Whisper)
    const mockTranscription: TranscriptionResult = {
      text: 'Hello Fool AI, can you help me with code generation and debugging?',
      language: 'en',
      timestamp: Date.now(),
      duration: 4.5,
      confidence: 0.98,
      segments: [
        { start: 0, end: 1.2, text: 'Hello Fool AI' },
        { start: 1.5, end: 3.8, text: 'Can you help me with code generation' },
        { start: 4.0, end: 4.5, text: 'and debugging?' },
      ],
    }

    setTranscription(mockTranscription)
    setStatus('speaking')

    // Generate response (in real app, this would call LLM)
    const mockResponse: TTSResult = {
      text: 'Of course! I can definitely help with code generation and debugging. What specific task would you like me to work on? Please describe your project or the issue you need help solving.',
      duration: 8.2,
      speed: 0.5,
    }

    setResponse(mockResponse)
    setIsSpeaking(true)
    setStatus('speaking')
  }, [])

  /** Handle stop button */
  const handleStop = useCallback(() => {
    stopListening()
  }, [stopListening])

  /** Reset to idle state */
  const handleReset = useCallback(() => {
    setTranscription(null)
    setResponse(null)
    setProgress(0)
    setIsSpeaking(false)
    setIsListening(false)
    setStatus('idle')
  }, [])

  return (
    <div className="p-4 space-y-6">
      {/* Header */}
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-bold flex items-center justify-center gap-3">
          🎤 Voice Assistant
        </h1>
        <p className="text-gray-600">
          Speak naturally to The Fool. I can listen, understand, and respond with natural-sounding voice.
        </p>

        {/* Status Indicator */}
        <div className="flex items-center justify-center gap-4 mt-4">
          {isListening && (
            <>
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
              </span>
              <Tag color="green" bordered>Pulse: Listening...</Tag>
            </>
          )}

          {isSpeaking && (
            <>
              <span className="relative flex h-3 w-3">
                <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
              </span>
              <Tag color="green" bordered>Pulse: Speaking...</Tag>
            </>
          )}

          {status === 'processing' && (
            <>
              <span className="relative flex h-3 w-3">
                <span className="animate-bounce absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
              </span>
              <Tag color="yellow" bordered>Processing...</Tag>
            </>
          )}
        </div>
      </div>

      {/* Recording Progress Bar */}
      {isListening && (
        <Card style={{ maxWidth: '400px', margin: '0 auto' }}>
          <Progress
            percent={progress}
            strokeColor="cyan"
            status="active"
            format={(value) => `${value}%`}
            style={{ width: '100%', height: 8 }}
          />
        </Card>
      )}

      {/* Controls */}
      <Space justify="center" size="L" style={{ marginTop: '16px' }}>
        <Button
          type={isListening ? 'default' : 'primary'}
          shape="circle"
          size="large"
          icon={isListening ? StopFilled : MicFilled}
          onClick={isListening ? handleStop : handleStartListening}
          style={{ width: 80, height: 80 }}
        />
      </Space>

      {/* Status Messages */}
      <Card className="text-center text-sm">
        {status === 'idle' && (
          <div className="py-8">
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}>
              <p className="text-gray-500 mb-4">Click the microphone to start listening</p>
              <Space direction="vertical" size="S">
                <Tag color="blue">Whisper Turbo: Fast & Accurate (98 languages)</Tag>
                <Tag color="green">Piper TTS: Natural & Realistic (~82ms/sentence)</Tag>
              </Space>
            </Empty>
          </div>
        )}

        {status === 'listening' && (
          <div className="py-4 text-sky-600 font-medium">
            🔊 Listening... Speak clearly
          </div>
        )}

        {status === 'processing' && (
          <div className="py-4 text-violet-600 font-medium flex items-center justify-center gap-2">
            ⚡ Processing your request...
          </div>
        )}

        {status === 'speaking' && (
          <div className="py-4 text-green-600 font-medium flex items-center justify-center gap-2">
            🗣️ Speaking response...
          </div>
        )}
      </Card>

      {/* Transcription Display */}
      {transcription && (
        <Card title="🎤 Your Voice Message" style={{ width: '100%' }}>
          <div className="space-y-4">
            <Text strong>{transcription.text}</Text>

            <Space wrap size="S">
              <Tag color="green">{(transcription.duration).toFixed(1)}s</Tag>
              <Tag color="blue">{transcription.confidence.toFixed(2)}</Tag>
              <Tag color="orange">{transcription.language.toUpperCase()}</Tag>
            </Space>

            {/* Segments Timeline */}
            <div className="bg-gray-50 rounded-lg p-4">
              <Text type="secondary" className="text-xs mb-2 block">Segments:</Text>
              {transcription.segments.map((segment, index) => (
                <div key={index} className="flex items-center gap-3 text-sm py-1">
                  <span className="font-mono text-gray-500">[{segment.start.toFixed(1)}-{segment.end.toFixed(1)}]</span>
                  <Text>{segment.text}</Text>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Response Display */}
      {response && (
        <Card title="🎭 AI Response" style={{ width: '100%' }}>
          <div className="space-y-4">
            <Text strong>{response.text}</Text>

            <Space wrap size="S">
              <Tag color="purple">{(response.duration).toFixed(1)}s</Tag>
              <Tag color="green">High Quality</Tag>
            </Space>

            {/* Response Controls */}
            <Space justify="end">
              <Button icon={PlayCircleOutlined} onClick={async () => {
                // Re-speak response logic
              }}>
                Replay
              </Button>
              <Button onClick={() => setResponse(null)}>Dismiss</Button>
            </Space>
          </div>
        </Card>
      )}

      {/* Input Field */}
      <Card style={{ width: '100%' }}>
        <Input.TextArea
          placeholder="Or type your message and click Send to speak..."
          showCount
          maxLength={2000}
          rows={4}
          autoSize={{ minRows: 4, maxRows: 8 }}
          onPressEnter={() => {
            if (transcription) {
              setResponse(null)
            }
          }}
        />

        <Space style={{ marginTop: '12px' }}>
          <Button type="primary" onClick={handleStartListening} icon={MicFilled}>
            Start Speaking
          </Button>
          {response && (
            <Button onClick={() => setResponse(null)}>Clear Response</Button>
          )}
        </Space>

        {/* Input Tips */}
        <div className="mt-4 p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
          💡 Tip: For best voice recognition, use a quiet environment and speak clearly.
          The Fool supports 98 languages via Whisper Turbo (fast) or Whisper Large-v3 (accurate).
        </div>
      </Card>

      {/* Quick Tips */}
      <Space wrap style={{ marginTop: '16px' }}>
        <Card className="text-sm">
          <Text strong>🔊 STT Options:</Text>
          <ul className="mt-2 space-y-1 text-gray-600">
            <li>Whisper Turbo: Fast (~93 tokens/s)</li>
            <li>Whisper Large-v3: Most accurate</li>
          </ul>
        </Card>

        <Card className="text-sm">
          <Text strong>🗣️ TTS Options:</Text>
          <ul className="mt-2 space-y-1 text-gray-600">
            <li>Piper: Fastest (~82ms/sentence)</li>
            <li>Kokoro: Most natural</li>
            <li>Kitten: Smallest model</li>
          </ul>
        </Card>

        <Card className="text-sm">
          <Text strong>⚡ Performance:</Text>
          <ul className="mt-2 space-y-1 text-gray-600">
            <li>Latency: &lt;50ms</li>
            <li>Memory: ~80MB</li>
            <li>Supported Languages: 98+</li>
          </ul>
        </Card>
      </Space>
    </div>
  )
}
