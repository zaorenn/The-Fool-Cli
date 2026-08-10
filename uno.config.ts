/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from 'unocss'
import { defineConfig } from 'unocss'
import { presetUno, presetAttributecase, presetIcons, presetTypography } from 'unocss/presets'

/**
 * Semantic Color Tokens - never use hardcoded color values in components.
 */
export const semanticColors = {
  // Base colors
  primary: '#6366f1',       // Indigo-500 — main brand color (AI theme)
  secondary: '#8b5cf6',     // Violet-500 — accent interactions
  success: '#22c55e',        // Green-500 — positive actions
  warning: '#f59e0b',        // Amber-500 — warnings and notifications
  danger: '#ef4444',         // Red-500 — errors and destructive actions,

  // Voice/Audio specific colors (STT/TTS visual feedback)
  voiceActive: '#0ea5e9',    // Sky-500 — recording indicator
  voiceListening: '#fbbf24', // Amber-400 — wake word active
  voiceSpeaking: '#8b5cf6',  // Violet-500 — TTS playing
  voiceMuted: '#6b7280',     // Gray-400 — muted state,

  /** Font families for accessibility and readability. */
  fontFamily: {
    sans: ['Inter', 'SF Pro Display', '-apple-system', 'sans-serif'],
    mono: ['Fira Code', 'JetBrains Mono', 'Monaco', 'monospace'],
  },
}

/**
 * UnoCSS configuration for The Fool AI application.
 */
export default defineConfig<Config>({
  /** Presets for UnoCSS functionality. */
  presets: [presetUno(), presetAttributecase(), presetIcons(), presetTypography()],

  /** Theme colors using semantic tokens. */
  theme: {
    colors: { ...semanticColors },
    fontSize: {
      xs: ['0.75rem', { lineHeight: 1.5 }],
      sm: ['0.875rem', { lineHeight: 1.5 }],
      base: ['1rem', { lineHeight: 1.5 }],
      lg: ['1.125rem', { lineHeight: 1.5 }],
      xl: ['1.25rem', { lineHeight: 1.5 }],
      '2xl': ['1.5rem', { lineHeight: 1.25 }],
    },
  },

  /** CSS variable mappings for theme support. */
  varPrefix: 'fool',

  /** Theme configuration - animations, keyframes, and shadows. */
  theme: {
    animation: {
      pulse: 'pulse',
      bounce: 'bounce',
      fade: 'fade-in',
    },
    keyframes: {
      pulse: {
        '0%, 100%': { opacity: '1' },
        '50%': { opacity: '0.7' },
      },
      bounce: {
        '0%, 100%': { transform: 'translateY(0)' },
        '50%': { transform: 'translateY(-3px)' },
      },
      'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
    },
  },

  /** Custom utilities for The Fool-specific styling patterns. */
  rules: [
    ['voice-recording', { animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' }],
    ['voice-listening', { animation: 'bounce 1s ease-in-out infinite' }],
    ['ai-glow', { boxShadow: '0 0 20px rgba(99, 102, 241, 0.3)' }],
  ],

  /** Custom shortcuts for common UI patterns. */
  shortcuts: [
    ['btn', 'inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none'],
    ['card', 'rounded-lg border bg-card text-card-foreground shadow-sm'],
    ['dialog', 'fixed inset-0 z-50 flex items-center justify-center'],
  ],

  /** Layer order for better performance. */
  layerOrder: ['default', 'theme', 'components', 'utilities', 'at-rule', 'responsive'],

  /** Enable shortcuts and variants. */
  enableShortcuts: true,

  /** Custom content and postprocessors. */
  content: ['**/*.{vue,ts,tsx}'],
})
