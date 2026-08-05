import { describe, expect, it } from 'vitest';
import type { IProvider } from '@/common/config/storage';
import { selectRealtimeProvider, toRealtimeSocketUrl } from '@process/services/realtime-voice/selectRealtimeProvider';

const provider = (overrides: Partial<IProvider>): IProvider =>
  ({
    id: 'p1',
    platform: 'openai',
    name: 'OpenAI',
    base_url: 'https://api.openai.com/v1',
    api_key: 'sk-live',
    models: [],
    ...overrides,
  }) as IProvider;

describe('deriving a realtime socket URL', () => {
  it('upgrades an https base URL to a secure socket on the realtime path', () => {
    expect(toRealtimeSocketUrl('https://api.openai.com/v1')).toBe('wss://api.openai.com/v1/realtime');
  });

  it('keeps a trailing slash from doubling up in the path', () => {
    expect(toRealtimeSocketUrl('https://gateway.example.com/v1/')).toBe('wss://gateway.example.com/v1/realtime');
  });

  it('allows a plain socket only for a gateway on this machine', () => {
    expect(toRealtimeSocketUrl('http://127.0.0.1:3000/v1')).toBe('ws://127.0.0.1:3000/v1/realtime');
    expect(toRealtimeSocketUrl('http://gateway.example.com/v1')).toBeNull();
  });

  it('refuses a base URL that is not a URL', () => {
    expect(toRealtimeSocketUrl('')).toBeNull();
    expect(toRealtimeSocketUrl('api.openai.com')).toBeNull();
  });
});

describe('choosing which account pays for a conversation', () => {
  it('picks the first enabled provider whose platform can carry the session', () => {
    const chosen = selectRealtimeProvider([provider({}), provider({ id: 'p2', name: 'Second' })], 'openai-realtime');
    expect(chosen?.providerName).toBe('OpenAI');
    expect(chosen?.socketUrl).toBe('wss://api.openai.com/v1/realtime');
  });

  it('skips a provider the user switched off', () => {
    const chosen = selectRealtimeProvider(
      [provider({ enabled: false }), provider({ id: 'p2', name: 'Second' })],
      'openai-realtime'
    );
    expect(chosen?.providerName).toBe('Second');
  });

  it('skips a provider whose key was never filled in', () => {
    expect(selectRealtimeProvider([provider({ api_key: '   ' })], 'openai-realtime')).toBeNull();
  });

  it('does not pay for an OpenAI session with a Gemini key', () => {
    expect(selectRealtimeProvider([provider({ platform: 'gemini' })], 'openai-realtime')).toBeNull();
  });

  it('accepts a Gemini key even though its socket has nothing to do with the base URL', () => {
    const chosen = selectRealtimeProvider(
      [provider({ platform: 'gemini', name: 'Google', base_url: '', api_key: 'AIza-test' })],
      'gemini-live'
    );
    expect(chosen?.apiKey).toBe('AIza-test');
    expect(chosen?.socketUrl).toBe('');
  });

  it('skips an OpenAI provider whose base URL cannot become a secure socket', () => {
    expect(
      selectRealtimeProvider([provider({ base_url: 'http://gateway.example.com/v1' })], 'openai-realtime')
    ).toBeNull();
  });

  it('needs no account at all for the pipeline running on this machine', () => {
    expect(selectRealtimeProvider([provider({})], 'local-s2s')).toBeNull();
  });

  it('finds nothing in an empty provider list', () => {
    expect(selectRealtimeProvider([], 'openai-realtime')).toBeNull();
  });
});
