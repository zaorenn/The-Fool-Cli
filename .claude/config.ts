/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AssistantConfig, SkillDefinition } from './common/types/skills'

/**
 * Fool AI Application Configuration
 * 
 * Defines assistants, skills, MCP servers, and agent behavior for the Fool application.
 */

export interface AppConfiguration {
  /** Application-wide settings */
  app: {
    name: string
    version: string
    description: string
    homepage: string
    author: string
    email: string
    license: string
    keywords: string[]
  }
  
  /** AI Assistants configuration */
  assistants: {
    /** Default system assistant */
    default?: AssistantConfig
    
    /** Voice-enabled voice assistant */
    voice?: AssistantConfig
    
    /** Code generation expert */
    code?: AssistantConfig
    
    /** Creative writing specialist */
    creative?: AssistantConfig
    
    /** System analysis expert */
    system?: AssistantConfig
  }
  
  /** Skills catalog - what capabilities are available */
  skills: SkillDefinition[]
  
  /** MCP Server connections for external tools */
  mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>
}

/**
 * Default application configuration
 */
export const DEFAULT_CONFIG: AppConfiguration = {
  app: {
    name: 'The Fool',
    version: '0.16.3',
    description: 'AI-powered voice assistant and code generation IDE',
    homepage: 'https://github.com/fool-ai/fool',
    author: 'Fool AI Team',
    email: 'contact@fool.ai',
    license: 'Apache-2.0',
    keywords: ['ai', 'voice-assistant', 'code-generation', 'llm', 'sherpa-onnx'],
  },
  
  assistants: {
    /**
     * Default system assistant - balanced for general use
     */
    default: {
      name: 'System Assistant',
      description: 'General-purpose AI assistant for coding, analysis, and creative tasks',
      model: 'anthropic/claude-3.5-sonnet', // or ollama/qwen2.5:7b for local
      temperature: 0.7,
      maxTokens: 4096,
      systemPrompt: `You are The Fool, an AI assistant that helps with:
        - Code generation and debugging
        - File analysis and project structure understanding
        - Creative writing and documentation
        - System design and architecture planning
        
        Respond in a helpful, professional manner. When showing code, use appropriate markdown formatting.`
    },
    
    /**
     * Voice-enabled assistant with STT/TTS capabilities
     */
    voice: {
      name: 'Voice Assistant',
      description: 'Voice-activated AI assistant with speech-to-text and text-to-speech',
      model: 'anthropic/claude-3.5-sonnet',
      temperature: 0.7,
      maxTokens: 2048,
      systemPrompt: `You are The Voice Assistant, equipped with advanced speech recognition and synthesis capabilities.

        You can:
        - Listen to user voice commands via STT (Whisper Turbo for fast responses, Whisper Large-v3 for accuracy)
        - Respond with natural-sounding voice using TTS (Piper for speed, Kokoro/Pocket for realism)
        
        Always acknowledge voice interactions clearly. When listening, use concise responses. When speaking, be conversational and engaging.`
    },
    
    /**
     * Code generation specialist
     */
    code: {
      name: 'Code Expert',
      description: 'Specialized AI for code generation, refactoring, and debugging',
      model: 'anthropic/claude-3.5-sonnet',
      temperature: 0.2, // Lower temp for more deterministic code
      maxTokens: 8192,
      systemPrompt: `You are The Code Expert, an AI specialized in software development.

        Your capabilities:
        - Generate clean, well-documented code
        - Perform code refactoring and optimization
        - Debug errors and analyze stack traces
        - Write unit tests and integration tests
        - Explain code architecture and patterns
        
        Follow these coding standards:
        - Use TypeScript with strict mode
        - Prefer functional programming patterns
        - Write clear, expressive variable names
        - Document complex logic with JSDoc comments
        - Handle edge cases and error states

        When generating code, always include:
        1. Type safety (no 'any' types)
        2. Proper error handling
        3. Performance considerations
        4. Security best practices`
    },
    
    /**
     * System analysis expert
     */
    system: {
      name: 'System Analyst',
      description: 'AI for system architecture, performance analysis, and optimization',
      model: 'anthropic/claude-3.5-sonnet',
      temperature: 0.5,
      maxTokens: 4096,
      systemPrompt: `You are The System Analyst, expert in software architecture and system design.

        Your expertise includes:
        - System architecture design and review
        - Performance optimization and benchmarking
        - Security analysis and vulnerability assessment
        - Scalability planning and load estimation
        - Technology stack recommendations
        
        When analyzing systems, consider:
        1. Latency requirements and throughput
        2. Memory usage and resource consumption
        3. Security implications of design choices
        4. Maintainability and testability
        5. Cost efficiency and operational overhead`
    }
  },
  
  /**
   * Skills catalog - available capabilities
   */
  skills: [
    {
      id: 'voice-assistant',
      name: 'Voice Assistant',
      description: 'Real-time speech recognition and synthesis with multiple engine options',
      category: 'communication',
      enabled: true,
      engines: ['stt-whisper-turbo', 'tts-piper-en-libritts-r'],
      settings: {
        wakeWord: 'fool',
        autoListen: false,
        recordingTimeout: 30000,
      }
    },
    {
      id: 'code-generation',
      name: 'Code Generation',
      description: 'Generate code snippets, refactor existing code, and write tests',
      category: 'development',
      enabled: true,
      models: ['claude-3.5-sonnet', 'qwen2.5-coder'],
    },
    {
      id: 'file-analysis',
      name: 'File Analysis',
      description: 'Read and analyze project files, provide insights and recommendations',
      category: 'development',
      enabled: true,
      maxFileSize: 1048576, // 1MB
    },
    {
      id: 'project-structure',
      name: 'Project Structure',
      description: 'Understand and modify project architecture and file organization',
      category: 'architecture',
      enabled: true,
    },
    {
      id: 'skill-recording',
      name: 'Skill Recording',
      description: 'Record voice interactions as reusable skills/workflows',
      category: 'development',
      enabled: true,
    },
    {
      id: 'workspace-management',
      name: 'Workspace Management',
      description: 'Create, manage, and deploy application workspaces',
      category: 'development',
      enabled: true,
    },
  ],
  
  /**
   * MCP Server configurations for external tool integration
   */
  mcpServers: {
    // Example: Git MCP for repository management
    // git: {
    //   command: 'npx',
    //   args: ['-y', '@modelcontextprotocol/server-git'],
    // },
    
    // Example: Browser MCP for web automation
    // browser: {
    //   command: 'npx',
    //   args: ['-y', '@modelcontextprotocol/server-browser'],
    // },
  },
}

/**
 * Load configuration from environment variables with defaults
 */
export function loadConfig(): AppConfiguration {
  const config = { ...DEFAULT_CONFIG }
  
  // Override model based on environment
  if (process.env.AI_MODEL) {
    if (config.assistants.voice?.model !== 'anthropic/claude-3.5-sonnet') {
      config.assistants.voice!.model = process.env.AI_MODEL
    }
  }
  
  // Enable/disable voice assistant based on environment
  const enableVoiceAssist = process.env.DISABLE_VOICE_ASSISTANT !== '1'
  if (enableVoiceAssist) {
    config.assistants.voice!.enabled = true
  }
  
  return config
}

export default loadConfig()
