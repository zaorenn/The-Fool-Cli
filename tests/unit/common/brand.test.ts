import { describe, expect, it } from 'vitest';
import {
  APP_ID,
  AUTO_UPDATE_ENABLED,
  LEGAL_ATTRIBUTION,
  PRODUCT_EXECUTABLE_NAME,
  PRODUCT_NAME,
  PRODUCT_PROTOCOL,
  PRODUCT_SLUG,
} from '@/common/brand';

describe('The Fool product identity', () => {
  it('exposes one canonical identity for every runtime surface', () => {
    expect(PRODUCT_NAME).toBe('The Fool');
    expect(PRODUCT_SLUG).toBe('the-fool');
    expect(PRODUCT_EXECUTABLE_NAME).toBe('TheFool');
    expect(PRODUCT_PROTOCOL).toBe('thefool');
    expect(APP_ID).toBe('com.thefool.app');
  });

  it('preserves upstream attribution without enabling upstream updates', () => {
    expect(LEGAL_ATTRIBUTION).toBe('Based on AionUi — Apache-2.0');
    expect(AUTO_UPDATE_ENABLED).toBe(false);
  });
});
