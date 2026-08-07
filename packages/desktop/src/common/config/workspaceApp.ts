/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A workspace's own front end, and how it reaches the rest of the app.
 *
 * A workspace could already change how The Fool looks and behaves. This is the
 * part that lets it *be* something else: a page of its own — a panel that turns
 * a link into guitar tab, a board that watches a build, whatever somebody
 * thought of — living inside the app rather than in a browser tab beside it.
 *
 * The important decision here is what an app is allowed to be, and it is
 * deliberately narrow: **a static front end, and nothing else.** No server of its
 * own, no command to run, no dependencies to install.
 *
 * That is not a shortcut, it is the only version of this that can be shared.
 * A workspace is a file people send each other. A workspace that carried a
 * command and ran it on import would be remote code execution by file share,
 * dressed up as a feature — and no amount of "are you sure" makes that a good
 * thing to build.
 *
 * What replaces the missing back end is better than one anyway: the page talks
 * to The Fool. Fetching, reading, transcribing, calling a model, driving the
 * machine — all of it goes through the agent the user already has, over the
 * bridge below. So an app gets the whole application's abilities instead of
 * whatever its author remembered to bundle, and it inherits the user's own
 * models and keys rather than asking for new ones.
 */

/** What a workspace's app is, as stored beside the workspace. */
export type WorkspaceApp = {
  /** Folder under the workspace-apps root. Never a path the caller chose. */
  folder: string;
  /** What to call it in the tab that shows it. */
  title: string;
  /** The page to open, relative to the folder. */
  entry: string;
  /**
   * Skills the app expects to exist, by name.
   *
   * Declared rather than bundled: a skill is installed through the library, so
   * an imported workspace can say what it needs and the app can offer to fetch
   * what is missing instead of failing in a way the user cannot act on.
   */
  requiresSkills: string[];
};

export const MAX_APP_TITLE = 64;

/** A folder name from what the app is called, safe on every filesystem. */
export const appFolderName = (title: string): string => {
  const cleaned = title
    .trim()
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 48);
  return cleaned.length > 0 ? cleaned : 'app';
};

/**
 * The entry file, confined to the folder it belongs to.
 *
 * Anything with a drive, a scheme, a leading slash or a `..` in it is refused
 * rather than repaired: this ends up joined to a directory and opened, and every
 * character of it may have been written by a language model or arrived inside a
 * file somebody was sent.
 */
export const safeEntry = (value: unknown): string => {
  if (typeof value !== 'string') return 'index.html';
  const cleaned = value.trim().replaceAll('\\', '/');
  if (cleaned.length === 0) return 'index.html';
  if (/^[a-z]+:/i.test(cleaned) || cleaned.startsWith('/') || cleaned.split('/').includes('..')) return 'index.html';
  return cleaned.slice(0, 200);
};

export const sanitizeWorkspaceApp = (value: unknown): WorkspaceApp | null => {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;

  const title =
    typeof record.title === 'string' ? record.title.replaceAll(/\s+/g, ' ').trim().slice(0, MAX_APP_TITLE) : '';
  const folder = appFolderName(
    typeof record.folder === 'string' && record.folder.trim().length > 0 ? record.folder : title
  );
  if (title.length === 0) return null;

  return {
    folder,
    title,
    entry: safeEntry(record.entry),
    requiresSkills: Array.isArray(record.requiresSkills)
      ? record.requiresSkills.flatMap((skill) => {
          const cleaned = typeof skill === 'string' ? skill.trim().slice(0, 64) : '';
          return cleaned.length > 0 ? [cleaned] : [];
        })
      : [],
  };
};

/**
 * What an app may ask The Fool to do, and what comes back.
 *
 * The whole contract, on purpose. A page inside a workspace is written by an
 * agent from a spoken description, so the surface it is given has to be small
 * enough to describe in one paragraph and impossible to misuse — a page that
 * could name an arbitrary channel would be a page that could name one it was
 * never meant to reach.
 */
export type WorkspaceAppRequest =
  /** Hand a job to the agent and wait for what it reports back. */
  | { id: string; kind: 'ask'; prompt: string }
  /** Open a web page in the user's own browser. */
  | { id: string; kind: 'open'; url: string }
  /** Say something out loud, in the voice the user chose. */
  | { id: string; kind: 'say'; text: string }
  /** Keep something small between runs, under the app's own name. */
  | { id: string; kind: 'store'; key: string; value: string }
  | { id: string; kind: 'recall'; key: string }
  /**
   * Call one of the workspace's own addons, directly.
   *
   * The difference between this and `ask` is the whole reason addons exist.
   * `ask` costs a minute of an agent thinking and gives back prose; this calls a
   * function and gives back its result, in a second, with no model in the loop.
   * A page that needs pitch detection needs the second kind.
   */
  | { id: string; kind: 'call'; tool: string; args: Record<string, unknown> };

export type WorkspaceAppResponse = {
  id: string;
  ok: boolean;
  /** What the agent wrote, or what was recalled. */
  result?: string;
  error?: string;
};

/** The message channel, named so a stray `postMessage` cannot be mistaken for one. */
export const WORKSPACE_APP_CHANNEL = 'fool.workspace.app';

const KINDS = new Set(['ask', 'open', 'say', 'store', 'recall', 'call']);

/**
 * Reads a request out of whatever arrived on the window.
 *
 * Everything about this is untrusted: it comes from a page served over loopback
 * that an agent wrote. So the shape is checked rather than cast, and anything
 * that is not one of the five known kinds is dropped without a reply — a page
 * probing for what else it can reach learns nothing from silence.
 */
export const parseAppRequest = (data: unknown): WorkspaceAppRequest | null => {
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  if (record.channel !== WORKSPACE_APP_CHANNEL) return null;

  const id = typeof record.id === 'string' ? record.id.slice(0, 64) : '';
  const kind = typeof record.kind === 'string' ? record.kind : '';
  if (id.length === 0 || !KINDS.has(kind)) return null;

  const text = (key: string, limit: number): string =>
    typeof record[key] === 'string' ? (record[key] as string).slice(0, limit) : '';

  switch (kind) {
    case 'ask': {
      const prompt = text('prompt', 4000).trim();
      return prompt.length > 0 ? { id, kind: 'ask', prompt } : null;
    }
    case 'open': {
      const url = text('url', 2000).trim();
      // Only the web. `openExternal` hands anything else to whatever the system
      // registered for the scheme, and this argument came from a generated page.
      return /^https?:\/\/\S+$/i.test(url) ? { id, kind: 'open', url } : null;
    }
    case 'say': {
      const said = text('text', 2000).trim();
      return said.length > 0 ? { id, kind: 'say', text: said } : null;
    }
    case 'store': {
      const key = text('key', 64).trim();
      return key.length > 0 ? { id, kind: 'store', key, value: text('value', 100_000) } : null;
    }
    case 'recall': {
      const key = text('key', 64).trim();
      return key.length > 0 ? { id, kind: 'recall', key } : null;
    }
    case 'call': {
      const tool = text('tool', 64).trim();
      // The arguments go to an addon rather than to a shell, so their shape is
      // the server's business — but it has to be an object, because a string
      // here would be a page trying something else.
      const args = record.args;
      if (tool.length === 0 || typeof args !== 'object' || args === null || Array.isArray(args)) return null;
      return { id, kind: 'call', tool, args: args as Record<string, unknown> };
    }
    default:
      return null;
  }
};

/**
 * The bridge, as the generated page sees it.
 *
 * Injected into the app's own document rather than expected of its author: the
 * page is written by a model from a spoken description, and a contract it has to
 * remember to implement is a contract it will get wrong. This way "call
 * `fool.ask`" is the whole of what the agent has to know.
 */
export const WORKSPACE_APP_BRIDGE = `(() => {
  const CHANNEL = '${WORKSPACE_APP_CHANNEL}';
  const waiting = new Map();
  let next = 0;

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.channel !== CHANNEL || typeof data.id !== 'string') return;
    const settle = waiting.get(data.id);
    if (!settle) return;
    waiting.delete(data.id);
    data.ok ? settle.resolve(data.result ?? '') : settle.reject(new Error(data.error || 'failed'));
  });

  const send = (kind, fields) =>
    new Promise((resolve, reject) => {
      const id = 'r' + ++next;
      waiting.set(id, { resolve, reject });
      window.parent.postMessage({ channel: CHANNEL, id, kind, ...fields }, '*');
      // A request nobody answers must not leave a promise pending forever: an
      // app whose buttons stop responding is worse than one that reports a
      // failure it can show.
      setTimeout(() => {
        if (!waiting.has(id)) return;
        waiting.delete(id);
        reject(new Error('timed out'));
      }, 16 * 60 * 1000);
    });

  window.fool = {
    /** Hand a job to the agent. Minutes, not seconds — show something meanwhile. */
    ask: (prompt) => send('ask', { prompt: String(prompt) }),
    /** Open a page in the user's own browser. */
    open: (url) => send('open', { url: String(url) }),
    /** Say something out loud, in the voice they chose. */
    say: (text) => send('say', { text: String(text) }),
    /** Keep something small between runs. */
    store: (key, value) => send('store', { key: String(key), value: String(value) }),
    recall: (key) => send('recall', { key: String(key) }),
    /** Call one of this workspace's addons. A second, not a minute. */
    call: (tool, args) => send('call', { tool: String(tool), args: args ?? {} }),
  };
})();`;
