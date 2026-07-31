import type { ConfigKey, ConfigKeyMap } from './configKeys';
import { wsEmitter } from '@/common/adapter/httpBridge';

type Subscriber = (value: unknown) => void;

/**
 * Backend announcement that somebody's preferences moved.
 *
 * Must stay identical to `CLIENT_PREFERENCES_CHANGED_EVENT` in
 * `backend/core/crates/fool-system/src/client_pref.rs`; a mismatch is silent,
 * because an event nobody listens for looks exactly like no event at all.
 */
const CLIENT_PREFERENCES_CHANGED_EVENT = 'settings.clientPreferencesChanged';

/**
 * Compares two stored values, insensitive to the order of an object's keys.
 *
 * The cache holds the object this window wrote; the backend hands back one
 * rebuilt by its own JSON layer, which sorts keys. A plain string comparison
 * calls those two different and would report a change on every write we made
 * ourselves.
 */
const sameValue = (a: unknown, b: unknown): boolean => {
  const stable = (value: unknown): string =>
    JSON.stringify(value, (_key, inner: unknown) =>
      inner && typeof inner === 'object' && !Array.isArray(inner)
        ? Object.fromEntries(
            Object.entries(inner as Record<string, unknown>).toSorted(([x], [y]) => x.localeCompare(y))
          )
        : inner
    ) ?? 'undefined';
  return stable(a) === stable(b);
};

declare global {
  interface Window {
    __backendPort?: number;
  }
}

function getBaseUrl(): string {
  // WebUI browser mode: no preload, fetch same-origin so web-host's
  // static-server reverse-proxies /api/* to the backend.
  if (typeof window !== 'undefined' && typeof document !== 'undefined' && !(window as Window).__backendPort) {
    return '';
  }
  const port = typeof window !== 'undefined' ? (window as Window).__backendPort || 13400 : 13400;
  return `http://127.0.0.1:${port}`;
}

async function fetchJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${getBaseUrl()}${path}`;
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`ConfigService ${method} ${path} failed (${response.status}): ${errorBody}`);
  }
  const contentType = response.headers.get('Content-Type');
  if (!contentType?.includes('application/json')) {
    return undefined as T;
  }
  const json = await response.json();
  if (json && typeof json === 'object' && 'data' in json) {
    return json.data as T;
  }
  return json as T;
}

class ConfigServiceImpl {
  private cache = new Map<string, unknown>();
  private subscribers = new Map<string, Set<Subscriber>>();
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private watching = false;

  // Idempotent: concurrent callers share the same in-flight promise, and a
  // resolved init returns immediately. Modules that need persisted settings on
  // module load (theme/colorScheme/language) await whenReady() before reading.
  initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      const data = await fetchJson<Record<string, unknown>>('GET', '/api/settings/client');
      this.cache.clear();
      if (data) {
        for (const [key, value] of Object.entries(data)) {
          this.cache.set(key, value);
        }
      }
      // One-time theme migration: only when new keys are absent (idempotent).
      if (!this.cache.has('theme.activeId')) {
        const { migrateThemeConfig } = await import('@/common/theme/migrateThemeConfig');
        const migrated = migrateThemeConfig({
          theme: this.cache.get('theme') as string | undefined,
          'css.activeThemeId': this.cache.get('css.activeThemeId') as string | undefined,
          'css.themes': this.cache.get('css.themes') as never,
          customCss: this.cache.get('customCss') as string | undefined,
        });
        this.cache.set('theme.activeId', migrated['theme.activeId']);
        this.cache.set('theme.userThemes', migrated['theme.userThemes']);
        // Persist asynchronously; ignore failure (will re-run next launch).
        void fetchJson<void>('PUT', '/api/settings/client', migrated).catch(() => {});
      }
      this.initialized = true;
      this.watchBackend();
    })();
    this.initPromise.catch(() => {
      // Allow a future caller to retry after a transient failure
      this.initPromise = null;
    });
    return this.initPromise;
  }

  whenReady(): Promise<void> {
    return this.initialize();
  }

  get<K extends ConfigKey>(key: K): ConfigKeyMap[K] | undefined {
    return this.cache.get(key) as ConfigKeyMap[K] | undefined;
  }

  async set<K extends ConfigKey>(key: K, value: ConfigKeyMap[K]): Promise<void> {
    this.cache.set(key, value);
    this.notify(key, value);
    await fetchJson<void>('PUT', '/api/settings/client', { [key]: value });
  }

  setLocal<K extends ConfigKey>(key: K, value: ConfigKeyMap[K]): void {
    this.cache.set(key, value);
    this.notify(key, value);
  }

  async remove(key: ConfigKey): Promise<void> {
    this.cache.delete(key);
    this.notify(key, undefined);
    await fetchJson<void>('PUT', '/api/settings/client', { [key]: null });
  }

  async setBatch(entries: Partial<{ [K in ConfigKey]: ConfigKeyMap[K] }>): Promise<void> {
    for (const [key, value] of Object.entries(entries)) {
      this.cache.set(key, value);
      this.notify(key as ConfigKey, value);
    }
    await fetchJson<void>('PUT', '/api/settings/client', entries);
  }

  subscribe(key: ConfigKey, callback: Subscriber): () => void {
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }
    this.subscribers.get(key)!.add(callback);
    return () => {
      this.subscribers.get(key)?.delete(callback);
    };
  }

  /**
   * Re-read the named keys and tell whoever is watching them.
   *
   * Only keys whose value actually moved are announced, so a window hearing
   * about its own write — which it already applied — stays quiet.
   */
  async refreshKeys(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    const query = encodeURIComponent(keys.join(','));
    const fresh = await fetchJson<Record<string, unknown>>('GET', `/api/settings/client?keys=${query}`);

    for (const key of keys) {
      // A key the response omits was deleted, and falls back to its default.
      const next = fresh?.[key];
      if (sameValue(this.cache.get(key), next)) continue;
      if (next === undefined) this.cache.delete(key);
      else this.cache.set(key, next);
      this.notify(key as ConfigKey, next);
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  reset(): void {
    this.cache.clear();
    this.subscribers.clear();
    this.initialized = false;
    this.initPromise = null;
  }

  /**
   * Follow preferences written from outside this window.
   *
   * Settings are read once at startup, so a change made by anything else — the
   * config CLI an agent drives, another window, the WebUI — used to sit in the
   * database until the app was restarted. Subscribed once, after the first read
   * succeeds, and never torn down: the socket reconnects on its own and a
   * missed event costs a setting that looks like it did not take.
   */
  private watchBackend(): void {
    if (this.watching || typeof window === 'undefined') return;
    this.watching = true;
    wsEmitter<{ keys?: string[] } | undefined>(CLIENT_PREFERENCES_CHANGED_EVENT).on((payload) => {
      const keys = payload?.keys;
      if (!Array.isArray(keys)) return;
      // The read is authenticated and scoped to this user, so an announcement
      // about somebody else returns our own unchanged values and notifies
      // nothing. No filtering needed, and none that could be trusted anyway.
      void this.refreshKeys(keys).catch(() => {});
    });
  }

  private notify(key: ConfigKey, value: unknown): void {
    const subs = this.subscribers.get(key);
    if (subs) {
      for (const cb of subs) {
        cb(value);
      }
    }
  }
}

export const configService = new ConfigServiceImpl();
