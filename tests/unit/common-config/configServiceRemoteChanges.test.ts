/**
 * A window reads its settings once, at startup. Anything that writes them from
 * outside — the config CLI an agent drives, another window, the WebUI — used to
 * land in the database and stop there, so the change looked like it had not
 * worked until the app was restarted.
 *
 * These cover the following half of that: the backend announces which keys
 * moved, and this is what turns the announcement back into a live setting.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { wsEmitterMock, listeners } = vi.hoisted(() => {
  const listeners = new Map<string, (payload: unknown) => void>();
  return {
    listeners,
    wsEmitterMock: vi.fn((eventName: string) => ({
      on: (callback: (payload: unknown) => void) => {
        listeners.set(eventName, callback);
        return () => listeners.delete(eventName);
      },
      emit: () => {},
    })),
  };
});

vi.mock('@/common/adapter/httpBridge', () => ({ wsEmitter: wsEmitterMock }));

const CHANGED_EVENT = 'settings.clientPreferencesChanged';

/**
 * Drives one backend announcement and waits for the re-read it triggers.
 *
 * Counted rather than indexed: startup makes a variable number of requests,
 * because a store with no theme key writes one back as it migrates.
 */
const announce = async (keys: string[]): Promise<void> => {
  const before = fetchMock.mock.calls.length;
  listeners.get(CHANGED_EVENT)?.({ keys });
  await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
  // The request has been sent; let its response, and the cache write that
  // follows it, finish before anything is asserted.
  await new Promise((settle) => setTimeout(settle, 0));
};

const lastRequestUrl = (): string => String(fetchMock.mock.calls.at(-1)?.[0]);

let fetchMock: ReturnType<typeof vi.fn>;

const jsonResponse = (data: unknown) => ({
  ok: true,
  headers: { get: () => 'application/json' },
  json: async () => ({ data }),
  text: async () => '',
});

const loadService = async (stored: Record<string, unknown>) => {
  const { configService } = await import('@/common/config/configService');
  configService.reset();
  fetchMock.mockResolvedValue(jsonResponse(stored));
  await configService.initialize();
  return configService;
};

describe('configService following backend preference changes', () => {
  beforeEach(async () => {
    vi.resetModules();
    listeners.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { __backendPort: 13400 } as unknown as Window);
  });

  it('subscribes once the first read has succeeded', async () => {
    await loadService({ 'theme.activeId': 'dawn' });

    expect(wsEmitterMock).toHaveBeenCalledWith(CHANGED_EVENT);
  });

  it('applies a value written from outside and tells subscribers', async () => {
    const configService = await loadService({ 'theme.activeId': 'dawn' });
    const seen = vi.fn();
    configService.subscribe('theme.activeId', seen);

    fetchMock.mockResolvedValue(jsonResponse({ 'theme.activeId': 'midnight-ember' }));
    await announce(['theme.activeId']);

    expect(configService.get('theme.activeId')).toBe('midnight-ember');
    expect(seen).toHaveBeenCalledWith('midnight-ember');
  });

  it('stays quiet when the announced key did not actually move', async () => {
    const configService = await loadService({ 'pet.enabled': true });
    const seen = vi.fn();
    configService.subscribe('pet.enabled', seen);

    // What a window hears after its own write: the value is already applied,
    // and re-announcing it would re-render every reader for nothing.
    fetchMock.mockResolvedValue(jsonResponse({ 'pet.enabled': true }));
    await announce(['pet.enabled']);

    expect(seen).not.toHaveBeenCalled();
  });

  it('treats an object rebuilt with sorted keys as unchanged', async () => {
    const configService = await loadService({ 'ui.themeOverrides': { colors: { text: '#fff', primary: '#e2564a' } } });
    const seen = vi.fn();
    configService.subscribe('ui.themeOverrides', seen);

    // The backend's JSON layer sorts an object's keys, so the value it hands
    // back is never byte-identical to the one this window wrote.
    fetchMock.mockResolvedValue(
      jsonResponse({ 'ui.themeOverrides': { colors: { primary: '#e2564a', text: '#fff' } } })
    );
    await announce(['ui.themeOverrides']);

    expect(seen).not.toHaveBeenCalled();
  });

  it('drops a key the response no longer carries', async () => {
    const configService = await loadService({ 'pet.dnd': true });
    const seen = vi.fn();
    configService.subscribe('pet.dnd', seen);

    // Deleting a preference is how it goes back to its default, and the read
    // reports that by omitting the key rather than returning a value.
    fetchMock.mockResolvedValue(jsonResponse({}));
    await announce(['pet.dnd']);

    expect(configService.get('pet.dnd')).toBeUndefined();
    expect(seen).toHaveBeenCalledWith(undefined);
  });

  it('reads only the keys the announcement named', async () => {
    await loadService({ 'pet.size': 280 });

    fetchMock.mockResolvedValue(jsonResponse({ 'pet.size': 360 }));
    await announce(['pet.size']);

    expect(lastRequestUrl()).toContain('/api/settings/client?keys=pet.size');
  });

  it('uses the event name the backend broadcasts', () => {
    const repoRoot = resolve(__dirname, '../../..');
    const rust = readFileSync(resolve(repoRoot, 'backend/core/crates/fool-system/src/client_pref.rs'), 'utf8');

    // A mismatch here is silent: an event nobody listens for is
    // indistinguishable from no event at all.
    expect(rust).toContain(`CLIENT_PREFERENCES_CHANGED_EVENT: &str = "${CHANGED_EVENT}"`);
  });
});
