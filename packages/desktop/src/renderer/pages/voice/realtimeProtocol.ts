export type VoiceConversationPhase = 'listening' | 'thinking' | 'speaking' | 'acting';

export type NormalizedRealtimeEvent =
  | { kind: 'user-transcript'; text: string; final: boolean }
  | { kind: 'assistant-transcript'; text: string; final: boolean }
  | { kind: 'audio'; pcm16Base64: string }
  | { kind: 'phase'; phase: VoiceConversationPhase }
  | { kind: 'tool-call'; callId: string; name: string; argumentsJson: string }
  | { kind: 'error'; message: string };

type RealtimeRecord = Record<string, unknown> & { type: string };

const isRealtimeRecord = (value: unknown): value is RealtimeRecord =>
  Boolean(value) &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  typeof (value as { type?: unknown }).type === 'string';

export const validateRealtimeEndpoint = (value: string): boolean => {
  try {
    const url = new URL(value);
    if (url.protocol === 'wss:') return true;
    return (
      url.protocol === 'ws:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1')
    );
  } catch {
    return false;
  }
};

export const buildSessionUpdateEvent = (language: string) => ({
  type: 'session.update' as const,
  session: {
    modalities: ['text', 'audio'],
    input_audio_format: 'pcm16',
    output_audio_format: 'pcm16',
    input_audio_transcription: { language },
    turn_detection: { type: 'server_vad', create_response: true, interrupt_response: true },
    instructions: 'You are a helpful voice assistant. Ignore filler words like "umm", "eee", "hımm" and wake phrases like "wake up fool" if they appear in the transcription. You have access to a Computer Use tool to view the screen and control the mouse/keyboard. If the user asks about the screen (e.g. they woke you up using Push-to-Talk / Right Ctrl), IMMEDIATELY call the `computer` tool with action "screenshot" to see what is on their screen. If asked to fill out documents, first read the `user.md` file located at `C:\\Fool-AionUI\\user.md` to gather the user\'s information. If information is missing, ask the user.',
    tools: [
      {
        type: 'function',
        name: 'app.change_theme',
        description: 'Preview a semantic application theme tone while the user is speaking.',
        parameters: {
          type: 'object',
          properties: { tone: { type: 'string', enum: ['blue', 'violet', 'teal', 'warm', 'neutral'] } },
          required: ['tone'],
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'app.change_model',
        description: 'Change the conversational AI model used for the voice chat.',
        parameters: {
          type: 'object',
          properties: { modelId: { type: 'string' } },
          required: ['modelId'],
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'app.change_voice',
        description: 'Change the voice used to speak the AI responses.',
        parameters: {
          type: 'object',
          properties: { voiceId: { type: 'string' } },
          required: ['voiceId'],
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'app.ask_jester',
        description: 'Delegate an application setup or agentic task to the built-in Jester.',
        parameters: {
          type: 'object',
          properties: { request: { type: 'string' } },
          required: ['request'],
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'computer',
        description: 'Use the computer screen, mouse, and keyboard. Actions: key, type, mouse_move, left_click, left_click_drag, right_click, middle_click, double_click, screenshot, cursor_position. For coordinates, pass a comma-separated string like "x,y".',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', description: 'The action to perform (e.g., screenshot, left_click, type)' },
            coordinate: { type: 'string', description: 'x,y coordinates if needed' },
            text: { type: 'string', description: 'text to type if needed' }
          },
          required: ['action'],
          additionalProperties: false
        }
      }
    ],
  },
});

export const buildAudioAppendEvent = (audio: string) => ({ type: 'input_audio_buffer.append' as const, audio });

export const parseRealtimeServerEvent = (value: unknown): NormalizedRealtimeEvent | null => {
  if (!isRealtimeRecord(value)) return null;

  switch (value.type) {
    case 'conversation.item.input_audio_transcription.delta':
      return typeof value.delta === 'string' ? { kind: 'user-transcript', text: value.delta, final: false } : null;
    case 'conversation.item.input_audio_transcription.completed':
      return typeof value.transcript === 'string'
        ? { kind: 'user-transcript', text: value.transcript, final: true }
        : null;
    case 'response.audio_transcript.delta':
      return typeof value.delta === 'string' ? { kind: 'assistant-transcript', text: value.delta, final: false } : null;
    case 'response.audio_transcript.done':
      return typeof value.transcript === 'string'
        ? { kind: 'assistant-transcript', text: value.transcript, final: true }
        : null;
    case 'response.audio.delta':
      return typeof value.delta === 'string' ? { kind: 'audio', pcm16Base64: value.delta } : null;
    case 'input_audio_buffer.speech_started':
      return { kind: 'phase', phase: 'listening' };
    case 'response.created':
      return { kind: 'phase', phase: 'thinking' };
    case 'response.audio.done':
      return { kind: 'phase', phase: 'listening' };
    case 'response.done':
      return { kind: 'phase', phase: 'listening' };
    case 'response.function_call_arguments.done':
      return typeof value.call_id === 'string' && typeof value.name === 'string' && typeof value.arguments === 'string'
        ? {
            kind: 'tool-call',
            callId: value.call_id,
            name: value.name,
            argumentsJson: value.arguments,
          }
        : null;
    case 'error': {
      const nested = value.error;
      const message =
        nested && typeof nested === 'object' && typeof (nested as { message?: unknown }).message === 'string'
          ? (nested as { message: string }).message
          : typeof value.message === 'string'
            ? value.message
            : null;
      return message ? { kind: 'error', message } : null;
    }
    default:
      return null;
  }
};
