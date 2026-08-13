import { api } from '../../src/services/api';
import {
  createConversation,
  listConversations,
  listMessages,
  removeConversation,
  updateConversation,
} from '../../src/services/conversations';

jest.mock('../../src/services/api', () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const mockApi = api as unknown as {
  get: jest.Mock;
  post: jest.Mock;
  patch: jest.Mock;
  delete: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('listConversations', () => {
  it('asks the route the desktop asks', async () => {
    mockApi.get.mockResolvedValue({ data: { success: true, data: { items: [], total: 0, has_more: false } } });
    await listConversations();
    expect(mockApi.get).toHaveBeenCalledWith('/api/conversations', { params: undefined });
  });

  it('renames has_more at the boundary', async () => {
    mockApi.get.mockResolvedValue({
      data: { success: true, data: { items: [{ id: 'a' }], total: 9, has_more: true } },
    });
    await expect(listConversations()).resolves.toEqual({ items: [{ id: 'a' }], total: 9, hasMore: true });
  });

  it('survives a page that omits the counts', async () => {
    mockApi.get.mockResolvedValue({ data: { success: true, data: {} } });
    await expect(listConversations()).resolves.toEqual({ items: [], total: 0, hasMore: false });
  });

  /**
   * The defect this guards: the old bridge answered nothing at all and the
   * screens read that as "no conversations". A refusal must be loud.
   */
  it('throws rather than reporting an empty list when the server refuses', async () => {
    mockApi.get.mockResolvedValue({ data: { success: false, error: 'nope' } });
    await expect(listConversations()).rejects.toThrow('listConversations failed: nope');
  });

  it('throws when there is no envelope at all', async () => {
    mockApi.get.mockResolvedValue({ data: undefined });
    await expect(listConversations()).rejects.toThrow('listConversations failed: no response');
  });
});

describe('listMessages', () => {
  it('addresses the conversation and escapes its id', async () => {
    mockApi.get.mockResolvedValue({ data: { success: true, data: [] } });
    await listMessages('a/b');
    expect(mockApi.get).toHaveBeenCalledWith('/api/conversations/a%2Fb/messages');
  });
});

describe('createConversation', () => {
  it('posts the body and returns what the server made', async () => {
    mockApi.post.mockResolvedValue({ data: { success: true, data: { id: 'new' } } });
    await expect(createConversation({ type: 'foolrs' })).resolves.toEqual({ id: 'new' });
    expect(mockApi.post).toHaveBeenCalledWith('/api/conversations', { type: 'foolrs' });
  });
});

describe('updateConversation', () => {
  it('sends merge_extra in the body, as the desktop does', async () => {
    mockApi.patch.mockResolvedValue({ data: { success: true, data: true } });
    await updateConversation('c1', { name: 'x' }, true);
    expect(mockApi.patch).toHaveBeenCalledWith('/api/conversations/c1', { name: 'x', merge_extra: true });
  });
});

describe('removeConversation', () => {
  it('deletes the conversation', async () => {
    mockApi.delete.mockResolvedValue({ data: { success: true, data: true } });
    await removeConversation('c1');
    expect(mockApi.delete).toHaveBeenCalledWith('/api/conversations/c1');
  });

  it('throws when the server refuses', async () => {
    mockApi.delete.mockResolvedValue({ data: { success: false, error: 'busy' } });
    await expect(removeConversation('c1')).rejects.toThrow('removeConversation failed: busy');
  });
});
