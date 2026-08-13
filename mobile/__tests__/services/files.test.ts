import { api } from '../../src/services/api';
import { getFilesByDir, getImageBase64 } from '../../src/services/files';

jest.mock('../../src/services/api', () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const mockApi = api as unknown as {
  post: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getFilesByDir', () => {
  it('asks the route the desktop asks', async () => {
    mockApi.post.mockResolvedValue({ data: { success: true, data: [] } });
    await getFilesByDir('/home/me/project');
    expect(mockApi.post).toHaveBeenCalledWith('/api/fs/dir', {
      dir: '/home/me/project',
      root: '/home/me/project',
    });
  });

  it('lets the caller bound the walk with a separate root', async () => {
    mockApi.post.mockResolvedValue({ data: { success: true, data: [] } });
    await getFilesByDir('/home/me/project/src', '/home/me/project');
    expect(mockApi.post).toHaveBeenCalledWith('/api/fs/dir', {
      dir: '/home/me/project/src',
      root: '/home/me/project',
    });
  });

  /**
   * The path travels in the body, not in the URL, so it must arrive exactly as
   * given — escaping it here would ask the server for a directory that does not
   * exist.
   */
  it('sends awkward paths through untouched', async () => {
    mockApi.post.mockResolvedValue({ data: { success: true, data: [] } });
    await getFilesByDir('/home/me/a b/c&d');
    expect(mockApi.post).toHaveBeenCalledWith('/api/fs/dir', {
      dir: '/home/me/a b/c&d',
      root: '/home/me/a b/c&d',
    });
  });

  it('renames the tree at the boundary, children included', async () => {
    mockApi.post.mockResolvedValue({
      data: {
        success: true,
        data: [
          {
            name: 'src',
            full_path: '/p/src',
            relative_path: 'src',
            is_dir: true,
            is_file: false,
            children: [
              {
                name: 'a.ts',
                full_path: '/p/src/a.ts',
                relative_path: 'src/a.ts',
                is_dir: false,
                is_file: true,
              },
            ],
          },
        ],
      },
    });
    await expect(getFilesByDir('/p')).resolves.toEqual([
      {
        name: 'src',
        fullPath: '/p/src',
        relativePath: 'src',
        isDir: true,
        isFile: false,
        children: [
          {
            name: 'a.ts',
            fullPath: '/p/src/a.ts',
            relativePath: 'src/a.ts',
            isDir: false,
            isFile: true,
          },
        ],
      },
    ]);
  });

  it('leaves a leaf without a children key', async () => {
    mockApi.post.mockResolvedValue({
      data: {
        success: true,
        data: [
          { name: 'a.ts', full_path: '/p/a.ts', relative_path: 'a.ts', is_dir: false, is_file: true },
        ],
      },
    });
    const [leaf] = await getFilesByDir('/p');
    expect('children' in leaf).toBe(false);
  });

  it('survives an answer that carries no data', async () => {
    mockApi.post.mockResolvedValue({ data: { success: true } });
    await expect(getFilesByDir('/p')).resolves.toEqual([]);
  });

  /**
   * The defect this guards: the old channel answered nothing at all and the
   * picker read that as an empty directory. A refusal must be loud.
   */
  it('throws rather than reporting an empty tree when the server refuses', async () => {
    mockApi.post.mockResolvedValue({ data: { success: false, error: 'outside allowed roots' } });
    await expect(getFilesByDir('/etc')).rejects.toThrow(
      'getFilesByDir failed: outside allowed roots'
    );
  });

  it('throws when there is no envelope at all', async () => {
    mockApi.post.mockResolvedValue({ data: undefined });
    await expect(getFilesByDir('/p')).rejects.toThrow('getFilesByDir failed: no response');
  });
});

describe('getImageBase64', () => {
  it('asks the route the desktop asks', async () => {
    mockApi.post.mockResolvedValue({ data: { success: true, data: 'data:image/png;base64,AAA' } });
    await getImageBase64('/home/me/shot.png');
    expect(mockApi.post).toHaveBeenCalledWith('/api/fs/image-base64', {
      path: '/home/me/shot.png',
      workspace: undefined,
    });
  });

  it('carries a workspace when the file lives outside the default roots', async () => {
    mockApi.post.mockResolvedValue({ data: { success: true, data: 'data:image/png;base64,AAA' } });
    await getImageBase64('/w/shot.png', '/w');
    expect(mockApi.post).toHaveBeenCalledWith('/api/fs/image-base64', {
      path: '/w/shot.png',
      workspace: '/w',
    });
  });

  it('sends awkward paths through untouched, as the body is not a URL', async () => {
    mockApi.post.mockResolvedValue({ data: { success: true, data: 'data:image/png;base64,AAA' } });
    await getImageBase64('/home/me/a b/c&d.png');
    expect(mockApi.post).toHaveBeenCalledWith('/api/fs/image-base64', {
      path: '/home/me/a b/c&d.png',
      workspace: undefined,
    });
  });

  it('returns the data URL ready to hand to an Image', async () => {
    mockApi.post.mockResolvedValue({ data: { success: true, data: 'data:image/png;base64,AAA' } });
    await expect(getImageBase64('/p/a.png')).resolves.toBe('data:image/png;base64,AAA');
  });

  /**
   * A blank preview was the visible symptom of the dead channel. Failing loudly
   * is what lets the screen tell the difference between "no image" and "never
   * answered".
   */
  it('throws when the server refuses', async () => {
    mockApi.post.mockResolvedValue({ data: { success: false, error: 'cannot read image' } });
    await expect(getImageBase64('/p/gone.png')).rejects.toThrow(
      'getImageBase64 failed: cannot read image'
    );
  });

  it('throws when there is no envelope at all', async () => {
    mockApi.post.mockResolvedValue({ data: undefined });
    await expect(getImageBase64('/p/a.png')).rejects.toThrow('getImageBase64 failed: no response');
  });
});
