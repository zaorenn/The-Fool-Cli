import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(__dirname, '../..');
const readProjectFile = (path: string): string => readFileSync(resolve(projectRoot, path), 'utf8');

describe('The Fool packaging identity', () => {
  it('uses The Fool package metadata', () => {
    const packageJson = JSON.parse(readProjectFile('package.json')) as {
      name: string;
      productName?: string;
      description: string;
    };

    expect(packageJson.name).toBe('the-fool');
    expect(packageJson.productName).toBe('The Fool');
    expect(packageJson.description).toContain('voice-first desktop agent');
  });

  it('uses The Fool Windows installer and protocol metadata', () => {
    const builder = readProjectFile('packages/desktop/electron-builder.yml');

    expect(builder).toContain('appId: com.thefool.app');
    expect(builder).toContain('productName: The Fool');
    expect(builder).toContain('executableName: TheFool');
    expect(builder).toContain('name: The Fool Protocol');
    expect(builder).toContain('      - thefool');
  });

  it('publishes to the same repository the updater reads from', async () => {
    const builder = readProjectFile('packages/desktop/electron-builder.yml');
    const { PRODUCT_REPO_NAME, PRODUCT_REPO_OWNER } = await import('@/common/brand');

    // app-update.yml is generated from this block at pack time. If it drifts
    // from brand.ts the shipped app checks one repo and downloads from another.
    expect(builder).toContain(`owner: ${PRODUCT_REPO_OWNER}`);
    expect(builder).toContain(`repo: ${PRODUCT_REPO_NAME}`);
    expect(builder).toContain('publishAutoUpdate: true');
    expect(builder).not.toContain('iOfficeAI');
  });
});
