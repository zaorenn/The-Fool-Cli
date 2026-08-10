/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react'
import { Tabs, Card, Typography } from '@arco-design/web-react'
import AssistantManagerPage from './AssistantManager'
import VoiceSettingsPage from './VoiceSettings'
import VoiceAssistantPage from './VoiceAssistant'

const { Text } = Typography

/**
 * Main Assistant page layout with tab navigation
 */
export default function AssistantLayout() {
  const [activeTab, setActiveTab] = useState('manager')

  return (
    <div className="space-y-6">
      {/* Tabs Navigation */}
      <Tabs activeKey={activeTab} onChange={(key) => setActiveTab(key)} className="w-full">
        <Tabs.Tab key="manager" title="Assistant Manager">
          Configure and manage your AI assistants
        </Tabs.Tab>

        <Tabs.Tab key="voice-settings" title="Voice Settings">
          STT/TTS engine configuration
        </Tabs.Tab>

        <Tabs.Tab key="voice-assistant" title="Voice Assistant" icon="">
          🎤 Interact with voice AI assistant
        </Tabs.Tab>

        <Tabs.Tab key="history" title="Conversation History">
          View and replay past conversations
        </Tabs.Tab>
      </Tabs>

      {/* Tab Content */}
      <Card className="min-h-[500px]">
        {activeTab === 'manager' && (
          <AssistantManagerPage />
        )}

        {activeTab === 'voice-settings' && (
          <VoiceSettingsPage />
        )}

        {activeTab === 'voice-assistant' && (
          <VoiceAssistantPage />
        )}

        {activeTab === 'history' && (
          <div className="flex items-center justify-center h-[400px] text-gray-500">
            <Text type="secondary">Conversation history coming soon...</Text>
          </div>
        )}
      </Card>

      {/* Quick Stats Footer */}
      <Card className="border-none bg-blue-50">
        <div className="grid grid-cols-4 gap-4 text-center p-4">
          <div>
            <Text strong>Active Assistants</Text>
            <Text type="secondary" className="mt-1">3/5 configured</Text>
          </div>

          <div>
            <Text strong>STT Engine</Text>
            <Text type="secondary" className="mt-1">Whisper Turbo</Text>
          </div>

          <div>
            <Text strong>TTS Engine</Text>
            <Text type="secondary" className="mt-1">Piper (Fast)</Text>
          </div>

          <div>
            <Text strong>Latency</Text>
            <Text type="secondary" className="mt-1">&lt;50ms</Text>
          </div>
        </div>
      </Card>
    </div>
  )
}
