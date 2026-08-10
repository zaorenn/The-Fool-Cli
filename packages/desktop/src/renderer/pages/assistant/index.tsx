/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback } from 'react'
import {
  Button,
  Card,
  Space,
  Tag,
  Empty,
} from '@arco-design/web-react'
import type { AssistantConfig } from '@/common/types/skills'

const { List } = Card

/**
 * Assistant management page
 */
export default function AssistantPage() {
  const [assistants] = useState<AssistantConfig[]>([
    {
      id: 'default',
      name: 'Default Assistant',
      description: 'General-purpose AI assistant for coding and analysis',
      model: 'anthropic/claude-3.5-sonnet',
      temperature: 0.7,
      maxTokens: 4096,
      enabled: true,
    },
    {
      id: 'voice',
      name: 'Voice Assistant',
      description: 'Voice-enabled assistant with STT/TTS capabilities',
      model: 'anthropic/claude-3.5-sonnet',
      temperature: 0.7,
      maxTokens: 2048,
      enabled: true,
    },
    {
      id: 'code',
      name: 'Code Expert',
      description: 'Specialized AI for code generation and debugging',
      model: 'anthropic/claude-3.5-sonnet',
      temperature: 0.2,
      maxTokens: 8192,
      enabled: true,
    },
    {
      id: 'creative',
      name: 'Creative Writer',
      description: 'AI for creative writing and documentation',
      model: 'anthropic/claude-3.5-sonnet',
      temperature: 0.9,
      maxTokens: 4096,
      enabled: false,
    },
    {
      id: 'system',
      name: 'System Analyst',
      description: 'AI for system architecture and optimization',
      model: 'anthropic/claude-3.5-sonnet',
      temperature: 0.5,
      maxTokens: 4096,
      enabled: false,
    },
  ])

  const [selectedAssistantId] = useState<string | null>(null)

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">AI Assistants</h1>
        <p className="text-gray-600">
          Manage and configure your AI assistants. Select an assistant to customize its behavior.
        </p>
      </div>

      <Space direction="vertical" size="M" style={{ width: '100%' }}>
        {assistants.length > 0 ? (
          assistants.map((assistant) => (
            <List.Item key={assistant.id} className="transition-all hover:bg-gray-50">
              <Card>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <h3 className="text-lg font-semibold">{assistant.name}</h3>
                      <p className="text-sm text-gray-600">{assistant.description}</p>
                    </div>

                    {selectedAssistantId === assistant.id ? (
                      <Tag color="blue">Active</Tag>
                    ) : (
                      <Tag color={assistant.enabled ? 'green' : 'gray'}>
                        {assistant.enabled ? 'Ready' : 'Disabled'}
                      </Tag>
                    )}
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-4">
                      <span className="text-gray-500">Model:</span>
                      <span>{assistant.model}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-gray-500">Temperature:</span>
                      <span>{assistant.temperature.toFixed(1)}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-gray-500">Max Tokens:</span>
                      <span>{assistant.maxTokens.toLocaleString()}</span>
                    </div>
                  </div>

                  <Space>
                    <Button
                      type="primary"
                      size="small"
                      onClick={() => console.log(`Configure assistant: ${assistant.id}`)}
                    >
                      Configure
                    </Button>

                    {selectedAssistantId === assistant.id && (
                      <>
                        <Button size="small">Edit</Button>
                        <Button type="danger" size="small">Delete</Button>
                      </>
                    )}
                  </Space>
                </div>
              </Card>
            </List.Item>
          ))
        ) : (
          <Empty description="No assistants configured">
            <p className="text-gray-500 mb-4">
              Configure AI assistants from the settings panel or create new ones.
            </p>
          </Empty>
        )}

        {/* Create New Assistant Button */}
        <Card>
          <Space justify="end">
            <Button type="primary" onClick={() => console.log('Create new assistant')}>
              + Create Assistant
            </Button>
          </Space>
        </Card>
      </Space>
    </div>
  )
}
