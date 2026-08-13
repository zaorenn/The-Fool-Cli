/**
 * Files and images, over the transport that still carries them.
 *
 * The app used to ask for these on the WebSocket bridge, as `get-file-by-dir`
 * and `get-image-base64`. Neither name exists anywhere in the desktop any more
 * — the server accepts the message and never answers, so the file picker showed
 * an empty tree and image previews stayed blank, both without an error.
 *
 * Written against the same routes `common/adapter/ipcBridge.ts` calls
 * (`getFilesByDir` and `getImageBase64`, both `POST` under `/api/fs`), so the
 * two clients ask the same server the same questions.
 */

import { api } from './api';

/** The envelope foolcore wraps every REST answer in. */
type ApiEnvelope<T> = { success: boolean; data: T; error?: string };

/** One node of a directory tree, named as the screens read it. */
export type DirOrFile = {
  name: string;
  fullPath: string;
  relativePath: string;
  isDir: boolean;
  isFile: boolean;
  children?: DirOrFile[];
};

/** The same node as it travels: snake_case, straight off foolcore. */
type WireDirOrFile = {
  name: string;
  full_path: string;
  relative_path: string;
  is_dir: boolean;
  is_file: boolean;
  children?: WireDirOrFile[];
};

/**
 * Unwrap an answer, or say which call failed.
 *
 * The envelope is uniform, so a bare `response.data.data` would work — and
 * would turn a server-side refusal into `undefined` flowing onward, which is
 * the failure mode that made the old bridge silence look like empty data.
 */
function unwrap<T>(payload: ApiEnvelope<T> | undefined, call: string): T {
  if (!payload || payload.success !== true) {
    throw new Error(`${call} failed: ${payload?.error ?? 'no response'}`);
  }
  return payload.data;
}

/**
 * Rename a tree node's fields once, at the boundary.
 *
 * `/api/fs/dir` is one of the routes that answers in snake_case, and the tree
 * is recursive, so the children are renamed on the way through rather than at
 * every point a screen walks them.
 */
function toDirOrFile(node: WireDirOrFile): DirOrFile {
  const children = node.children?.map(toDirOrFile);
  return {
    name: node.name,
    fullPath: node.full_path,
    relativePath: node.relative_path,
    isDir: node.is_dir === true,
    isFile: node.is_file === true,
    ...(children ? { children } : {}),
  };
}

/**
 * One directory, as a tree.
 *
 * Was `get-file-by-dir`. `root` bounds what the server is willing to walk; the
 * pickers browse a single directory, so it defaults to `dir` itself. Both
 * travel in the body, which is why neither is URL-escaped — there is no path
 * segment here to escape.
 */
export async function getFilesByDir(dir: string, root: string = dir): Promise<DirOrFile[]> {
  const response = await api.post<ApiEnvelope<WireDirOrFile[]>>('/api/fs/dir', { dir, root });
  const nodes = unwrap(response.data, 'getFilesByDir') ?? [];
  return nodes.map(toDirOrFile);
}

/**
 * An image, already a `data:` URL.
 *
 * Was `get-image-base64`. The server reads the file, guesses the MIME type and
 * returns `data:<mime>;base64,<...>`, so the result goes straight into an
 * `Image` source with nothing to prepend.
 */
export async function getImageBase64(path: string, workspace?: string): Promise<string> {
  const response = await api.post<ApiEnvelope<string>>('/api/fs/image-base64', {
    path,
    workspace,
  });
  return unwrap(response.data, 'getImageBase64');
}
