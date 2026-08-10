/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback } from 'react'
import { Card, Button, Space, Tag, Typography, Modal, Input } from '@arco-design/web-react'
import type { AssistantConfig } from '@/common/types/skills'

const { Text } = Typography

/**
 * Assistant Manager - Main page for managing AI assistants
 */
export default function AssistantManagerPage() {
  const [assistants] = useState<AssistantConfig[]>([
    {
      id: 'system',
      name: 'System Assistant',
      description: 'General-purpose assistant for coding and analysis',
      model: 'anthropic/claude-3.5-sonnet',
      temperature: 0.7,
      maxTokens: 4096,
      enabled: true,
      role: 'system',
    },
    {
      id: 'voice',
      name: 'Voice Assistant',
      description: 'Voice-enabled assistant with STT/TTS capabilities',
      model: 'anthropic/claude-3.5-sonnet',
      temperature: 0.7,
      maxTokens: 2048,
      enabled: true,
      role: 'voice',
    },
    {
      id: 'code',
      name: 'Code Expert',
      description: 'Specialized for code generation and debugging',
      model: 'anthropic/claude-3.5-sonnet',
      temperature: 0.2,
      maxTokens: 8192,
      enabled: true,
      role: 'code',
    },
  ])

  const [selectedAssistantId] = useState<string | null>(null)
  const [editingAssistant, setEditingAssistant] = useState<AssistantConfig | null>(null)

  /** Open modal to edit assistant */
  const handleEdit = useCallback((assistant: AssistantConfig) => {
    setEditingAssistant(assistant)
  }, [])

  /** Close editor modal */
  const handleCloseEditor = useCallback(() => {
    setEditingAssistant(null)
  }, [])

  return (
    <div className="p-4 space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-2xl font-bold flex items-center gap-3">
          🤖 AI Assistants
        </h1>
        <p className="text-gray-600">
          Configure and manage your AI assistants. Select an assistant to customize its behavior and capabilities.
        </p>
      </div>

      {/* Assistants Grid */}
      <Space direction="vertical" size="M" style={{ width: '100%' }}>
        {assistants.map((assistant) => (
          <Card key={assistant.id} className="hover:shadow-lg transition-shadow cursor-pointer">
            <div className="space-y-4">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-semibold">{assistant.name}</h3>
                    {selectedAssistantId === assistant.id && (
                      <Tag color="blue">Selected</Tag>
                    )}
                    {!assistant.enabled && (
                      <Tag color="red" bordered>Disabled</Tag>
                    )}
                  </div>
                  <p className="text-sm text-gray-600">{assistant.description}</p>
                </div>

                <Button type="primary" onClick={() => handleEdit(assistant)}>
                  Configure
                </Button>
              </div>

              {/* Model Info */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Model:</span>
                  <span className="ml-2">{assistant.model}</span>
                </div>
                <div>
                  <span className="text-gray-500">Temperature:</span>
                  <span className="ml-2">{assistant.temperature.toFixed(1)}</span>
                </div>
                <div>
                  <span className="text-gray-500">Max Tokens:</span>
                  <span className="ml-2">{assistant.maxTokens.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-gray-500">Role:</span>
                  <Tag color={assistant.role === 'voice' ? 'cyan' : assistant.role === 'code' ? 'blue' : 'green'}>
                    {assistant.role}
                  </Tag>
                </div>
              </div>

              {/* Action Buttons */}
              <Space justify="end">
                <Button onClick={() => handleEdit(assistant)}>Edit</Button>
                {!assistant.enabled && (
                  <Button
                    type="primary"
                    onClick={() => {
                      // Enable assistant logic
                    }}
                  >
                    Enable
                  </Button>
                )}
              </Space>
            </div>
          </Card>
        ))}
      </Space>

      {/* Active Assistant Info */}
      <Card title="📊 Active Assistant Status" style={{ width: '100%' }}>
        {selectedAssistantId && (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <Text strong>Current Assistant:</Text>
              <Text>{assistants.find(a => a.id === selectedAssistantId)?.name}</Text>
            </div>

            <Space wrap>
              <Tag color="green">✓ Model Loaded</Tag>
              <Tag color="blue">✓ API Connected</Tag>
              {selectedAssistantId === 'voice' && (
                <>
                  <Tag color="cyan">✓ STT Ready</Tag>
                  <Tag color="cyan">✓ TTS Ready</Tag>
                </>
              )}
            </Space>

            {/* Quick Stats */}
            <div className="grid grid-cols-3 gap-4 pt-4 border-t">
              <div className="text-center p-3 bg-blue-50 rounded-lg">
                <Text type="secondary" className="mb-1 block text-xs">Context Window</Text>
                <Text strong className="text-lg">{(assistants.find(a => a.id === selectedAssistantId)?.maxTokens / 1024).toFixed(1)}K tokens</Text>
              </div>

              <div className="text-center p-3 bg-green-50 rounded-lg">
                <Text type="secondary" className="mb-1 block text-xs">Temperature</Text>
                <Text strong className="text-lg">{(assistants.find(a => a.id === selectedAssistantId)?.temperature).toFixed(2)}</Text>
              </div>

              <div className="text-center p-3 bg-purple-50 rounded-lg">
                <Text type="secondary" className="mb-1 block text-xs">Response Time</Text>
                <Text strong className="text-lg">&lt;2s</Text>
              </div>
            </div>
          </div>
        )}

        {!selectedAssistantId && (
          <div className="py-8 text-center text-gray-500">
            Select an assistant to view its status and performance metrics.
          </div>
        )}
      </Card>

      {/* Assistant Role Descriptions */}
      <Space wrap style={{ marginTop: '16px' }}>
        <Card title="🎯 Assistant Roles" className="text-sm">
          <ul className="space-y-2 text-gray-600">
            <li><strong>System:</strong> General-purpose assistant for everyday tasks</li>
            <li><strong>Voice:</strong> Speech-enabled assistant with STT/TTS capabilities</li>
            <li><strong>Code:</strong> Specialized for programming and code generation</li>
          </ul>
        </Card>

        <Card title="💡 Tips" className="text-sm">
          <ul className="space-y-2 text-gray-600">
            <li>✓ Enable Voice assistant for hands-free interaction</li>
            <li>✓ Use Code assistant for complex programming tasks</li>
            <li>✓ Adjust temperature for creativity vs precision balance</li>
          </ul>
        </Card>
      </Space>
    </div>
  )
}
