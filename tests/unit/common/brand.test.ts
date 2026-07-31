import { describe, expect, it } from 'vitest';
import {
  APP_ID,
  AUTO_UPDATE_ENABLED,
  LEGAL_ATTRIBUTION,
  PRODUCT_EXECUTABLE_NAME,
  PRODUCT_NAME,
  PRODUCT_PROTOCOL,
  PRODUCT_REPO,
  PRODUCT_REPO_URL,
  PRODUCT_SLUG,
  PRODUCT_SUPPORT_URL,
  PRODUCT_UPDATE_URL,
} from '@/common/brand';

describe('The Fool product identity', () => {
  it('exposes one canonical identity for every runtime surface', () => {
    expect(PRODUCT_NAME).toBe('The Fool');
    expect(PRODUCT_SLUG).toBe('the-fool');
    expect(PRODUCT_EXECUTABLE_NAME).toBe('TheFool');
    expect(PRODUCT_PROTOCOL).toBe('thefool');
    expect(APP_ID).toBe('com.thefool.app');
  });

  it('preserves upstream attribution', () => {
    expect(LEGAL_ATTRIBUTION).toBe('Based on AionUi — Apache-2.0');
  });

  it('updates from our own repository, never upstream', () => {
    expect(AUTO_UPDATE_ENABLED).toBe(true);
    expect(PRODUCT_REPO).toBe('zaorenn/The-Fool-Cli');
    expect(PRODUCT_REPO_URL).toBe('https://github.com/zaorenn/The-Fool-Cli');

    // The updater and the support links must not lead back to upstream: an
    // update pulled from there would overwrite this build with a different app.
    for (const url of [PRODUCT_UPDATE_URL, PRODUCT_SUPPORT_URL]) {
      expect(url).toBeTruthy();
      expect(url).toContain(PRODUCT_REPO);
      expect(url).not.toContain('iOfficeAI');
    }
  });
});
