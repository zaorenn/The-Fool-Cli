/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, test } from '../../fixtures';

test.describe('The Fool default theme', () => {
  test('boots a fresh profile with dark onyx and crimson tokens', async ({ page }) => {
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');

    const state = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      return {
        title: document.title,
        theme: document.documentElement.getAttribute('data-theme'),
        arcoTheme: document.body.getAttribute('arco-theme'),
        background: styles.getPropertyValue('--bg-base').trim(),
        primary: styles.getPropertyValue('--primary').trim(),
        text: styles.getPropertyValue('--text-primary').trim(),
      };
    });

    expect(state).toEqual({
      title: 'The Fool',
      theme: 'dark',
      arcoTheme: 'dark',
      background: '#0b0d10',
      primary: '#c4123f',
      text: '#f5f1e8',
    });

    await expect(page.getByText('The Fool', { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('guid-input')).toBeVisible();

    const sendBox = await page
      .locator('.guid-input-card-shell')
      .first()
      .evaluate((shell) => {
        const surface = shell.querySelector<HTMLElement>('.bg-dialog-fill-0');
        const input = shell.querySelector<HTMLElement>('[data-testid="guid-input"]');

        return {
          surface: surface ? getComputedStyle(surface).backgroundColor : null,
          text: input ? getComputedStyle(input).color : null,
        };
      });

    expect(sendBox).toEqual({
      surface: 'rgb(26, 30, 36)',
      text: 'rgb(245, 241, 232)',
    });
  });
});
