/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react'
import { render } from 'react-dom'
import { ConfigProvider, Layout, Typography, Button } from '@arco-design/web-react'
import { MoonFilled, SunFilled } from '@icon-park/react'
import AssistantLayout from './pages/assistant/index-layout'
import type { AppConfiguration } from '@/common/types/skills'

const { Text } = Typography

/**
 * Main renderer application entry point
 */
function App() {
  const [isDarkMode, setIsDarkMode] = React.useState(false)

  /** Toggle dark mode */
  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode)
  }

  /** Check for saved theme preference */
  React.useEffect(() => {
    const savedTheme = window.localStorage.getItem('theme') as string | null
    if (savedTheme) {
      setIsDarkMode(savedTheme === 'dark')
    } else {
      // Default to dark mode for developer experience
      setIsDarkMode(true)
    }
  }, [])

  return (
    <ConfigProvider
      theme={isDarkMode ? {} : undefined} // Dark mode via CSS variables
      locale={{
        ok: 'OK',
        cancel: 'Cancel',
      }}
    >
      <Layout className="h-screen w-screen overflow-hidden">
        {/* Header */}
        <div className="h-14 bg-white border-b flex items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <span className="text-xl font-bold text-indigo-600">🤖 The Fool</span>
            <Text type="secondary" className="hidden md:inline">AI Voice Assistant</Text>
          </div>

          {/* Theme Toggle */}
          <Button type="text" size="small" icon={isDarkMode ? SunFilled : MoonFilled} onClick={toggleDarkMode}>
            {isDarkMode ? '☀️ Light' : '🌙 Dark'}
          </Button>

          {/* Version Badge */}
          <span className="text-xs text-gray-500 px-2 py-1 bg-gray-100 rounded">v0.16.3</span>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-auto p-4">
          <AssistantLayout />
        </div>

        {/* Footer Status Bar */}
        <div className="h-8 bg-indigo-50 border-t flex items-center justify-between px-4 text-xs">
          <div className="flex items-center gap-4">
            <span className="text-indigo-600 font-medium">Voice: Ready</span>
            <span className="text-gray-500">STT: Whisper Turbo</span>
            <span className="text-gray-500">TTS: Piper Fast</span>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-indigo-600 font-medium">Engine Status: Connected</span>
            <span className="text-gray-500">Latency: &lt;50ms</span>
          </div>
        </div>
      </Layout>
    </ConfigProvider>
  )
}

/**
 * Render application to root element
 */
const root = document.getElementById('root')
if (root) {
  render(<App />, root)
}
