import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(__dirname, '../..');
const readProjectFile = (path: string): string => readFileSync(resolve(projectRoot, path), 'utf8');

describe('The Fool primary brand surfaces', () => {
  it('uses the centralized brand in runtime TypeScript surfaces', () => {
    const tray = readProjectFile('packages/desktop/src/process/utils/tray.ts');
    const titlebar = readProjectFile('packages/desktop/src/renderer/components/layout/Titlebar/index.tsx');
    const layout = readProjectFile('packages/desktop/src/renderer/components/layout/Layout.tsx');
    const about = readProjectFile(
      'packages/desktop/src/renderer/components/settings/SettingsModal/contents/AboutModalContent.tsx'
    );

    expect(tray).toContain('tray.setToolTip(PRODUCT_NAME)');
    expect(tray).toContain("path.join(resourcesPath, 'tray.png')");
    expect(titlebar).toContain('const appTitle = PRODUCT_NAME');
    expect(layout).toContain('{PRODUCT_NAME}');
    expect(about).toContain('{PRODUCT_NAME}');
    expect(about).toContain('{LEGAL_ATTRIBUTION}');

    expect(tray).not.toContain("tray.setToolTip('The Fool')");
    expect(titlebar).not.toContain("useMemo(() => 'The Fool'");
  });

  it('brands browser and installable web metadata as The Fool', () => {
    const html = readProjectFile('packages/desktop/src/renderer/index.html');
    const manifest = JSON.parse(readProjectFile('public/manifest.webmanifest')) as {
      name: string;
      short_name: string;
      description: string;
      background_color: string;
      theme_color: string;
    };

    expect(html).toContain('<meta name="application-name" content="The Fool" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="The Fool" />');
    expect(html).toContain('<title>The Fool</title>');
    expect(manifest.name).toBe('The Fool');
    expect(manifest.short_name).toBe('Fool');
    expect(manifest.description).toContain('voice-first desktop agent');
    expect(manifest.background_color).toBe('#0B0D10');
    expect(manifest.theme_color).toBe('#C4123F');
  });

  it('uses The Fool protocol and disables upstream update entry points', () => {
    const deepLink = readProjectFile('packages/desktop/src/process/utils/deepLink.ts');
    const bootstrap = readProjectFile('packages/desktop/src/index.ts');
    const appMenu = readProjectFile('packages/desktop/src/process/utils/appMenu.ts');

    expect(deepLink).toContain('PROTOCOL_SCHEME = PRODUCT_PROTOCOL');
    expect(deepLink).not.toContain("PROTOCOL_SCHEME = 'fool'");
    expect(bootstrap).toContain('!AUTO_UPDATE_ENABLED');
    expect(appMenu).toContain('if (AUTO_UPDATE_ENABLED)');
  });

  it('uses the central name for dev storage and model-provider attribution', () => {
    const platform = readProjectFile('packages/desktop/src/common/platform/index.ts');
    const appConfig = readProjectFile('packages/desktop/src/common/utils/appConfig.ts');
    const clientFactory = readProjectFile('packages/desktop/src/common/api/ClientFactory.ts');

    expect(platform).toContain('`${PRODUCT_EXECUTABLE_NAME}-Dev`');
    expect(appConfig).toContain('appConfig?.name || PRODUCT_NAME');
    expect(clientFactory).toContain("'X-Title': PRODUCT_NAME");
  });
});
