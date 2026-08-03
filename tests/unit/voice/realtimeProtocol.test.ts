import { describe, expect, it } from 'vitest';
import {
  buildAudioAppendEvent,
  buildSessionUpdateEvent,
  parseRealtimeServerEvent,
  validateRealtimeEndpoint,
} from '@/renderer/pages/voice/realtimeProtocol';

describe('speech-to-speech realtime protocol', () => {
  it('only accepts loopback ws or encrypted wss endpoints', () => {
    expect(validateRealtimeEndpoint('ws://127.0.0.1:8765/v1/realtime')).toBe(true);
    expect(validateRealtimeEndpoint('ws://localhost:8765/v1/realtime')).toBe(true);
    expect(validateRealtimeEndpoint('wss://voice.example.com/v1/realtime')).toBe(true);
    expect(validateRealtimeEndpoint('ws://voice.example.com/v1/realtime')).toBe(false);
    expect(validateRealtimeEndpoint('https://voice.example.com/v1/realtime')).toBe(false);
  });

  it('creates OpenAI Realtime-compatible session and audio events', () => {
    expect(buildSessionUpdateEvent('tr')).toMatchObject({
      type: 'session.update',
      session: { input_audio_format: 'pcm16', output_audio_format: 'pcm16' },
    });
    expect(buildAudioAppendEvent('AQI=')).toEqual({ type: 'input_audio_buffer.append', audio: 'AQI=' });
  });

  it('normalizes transcript, audio, response state, and function calls', () => {
    expect(
      parseRealtimeServerEvent({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'merhaba' })
    ).toEqual({ kind: 'user-transcript', text: 'merhaba', final: true });
    expect(parseRealtimeServerEvent({ type: 'response.audio.delta', delta: 'AQI=' })).toEqual({
      kind: 'audio',
      pcm16Base64: 'AQI=',
    });
    expect(parseRealtimeServerEvent({ type: 'response.audio_transcript.delta', delta: 'Selam' })).toEqual({
      kind: 'assistant-transcript',
      text: 'Selam',
      final: false,
    });
    expect(
      parseRealtimeServerEvent({
        type: 'response.function_call_arguments.done',
        call_id: 'call-1',
        name: 'app.change_theme',
        arguments: '{"tone":"blue"}',
      })
    ).toEqual({
      kind: 'tool-call',
      callId: 'call-1',
      name: 'app.change_theme',
      argumentsJson: '{"tone":"blue"}',
    });
    expect(parseRealtimeServerEvent({ type: 'response.created' })).toEqual({ kind: 'phase', phase: 'thinking' });
    expect(parseRealtimeServerEvent({ type: 'response.done' })).toEqual({ kind: 'phase', phase: 'listening' });
  });

  it('ignores malformed and unknown server events', () => {
    expect(parseRealtimeServerEvent({ type: 'response.audio.delta', delta: 12 })).toBeNull();
    expect(parseRealtimeServerEvent({ type: 'future.event' })).toBeNull();
    expect(parseRealtimeServerEvent(null)).toBeNull();
  });
});
