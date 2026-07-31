/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { isChatCapableModel } from '@/common/utils/modelCapabilities';

describe('isChatCapableModel', () => {
  it('accepts an ordinary chat model', () => {
    expect(isChatCapableModel('gpt-4o')).toBe(true);
    expect(isChatCapableModel('claude-3-5-sonnet')).toBe(true);
  });

  it('rejects an embedding model — it can answer a chat request with a vector, never a summary', () => {
    expect(isChatCapableModel('text-embedding-3-large')).toBe(false);
  });

  it('rejects a reranking model for the same reason', () => {
    expect(isChatCapableModel('bge-reranker-v2-m3')).toBe(false);
  });
});
