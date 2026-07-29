/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, test } from '../../fixtures';
import { findAssistantIdForBackend, navigateTo } from '../../helpers';
import { httpDelete, httpPost } from '../../helpers/httpBridge';

type CreatedConversation = { id: string };
type StreamRegistry = {
  controllers: Record<
    string,
    { runScenario: (options?: { historyPairs?: number; lines?: number; seedHistoryOnly?: boolean }) => Promise<void> }
  >;
};

const STREAM_INJECTOR_CONVERSATION_KEY = 'aionui:e2e-message-stream-conversation-id';

function contrastRatio(foreground: string, background: string): number {
  const toLuminance = (color: string) => {
    const channels = color
      .match(/\d+(?:\.\d+)?/g)
      ?.slice(0, 3)
      .map(Number);
    if (!channels || channels.length !== 3) {
      throw new Error('Expected an RGB color, received "' + color + '"');
    }

    const [red, green, blue] = channels.map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };

  const [lighter, darker] = [toLuminance(foreground), toLuminance(background)].toSorted((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

test.describe('The Fool default theme', () => {
  test('hydrates The Fool-specific tokens instead of only prepaint defaults', async ({ page }) => {
    await page.waitForFunction(
      () =>
        document.documentElement.getAttribute('data-theme') === 'dark' &&
        getComputedStyle(document.documentElement).getPropertyValue('--primary-6').trim() === '196, 18, 63'
    );

    const state = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      return {
        title: document.title,
        theme: document.documentElement.getAttribute('data-theme'),
        arcoTheme: document.body.getAttribute('arco-theme'),
        background: styles.getPropertyValue('--bg-base').trim(),
        primary: styles.getPropertyValue('--primary').trim(),
        primary6: styles.getPropertyValue('--primary-6').trim(),
        text: styles.getPropertyValue('--text-primary').trim(),
      };
    });

    expect(state).toEqual({
      title: 'The Fool',
      theme: 'dark',
      arcoTheme: 'dark',
      background: '#0b0d10',
      primary: '#c4123f',
      primary6: '196, 18, 63',
      text: '#f5f1e8',
    });

    await expect(page.getByText('The Fool', { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('guid-input')).toBeVisible();
  });

  test('keeps a rendered real-conversation message readable', async ({ page }) => {
    const assistantId = await findAssistantIdForBackend(page, 'claude');
    test.skip(!assistantId, 'No Claude assistant is registered for the real-conversation theme surface check');
    if (!assistantId) return;

    const conversation = await httpPost<CreatedConversation>(page, '/api/conversations', {
      id: 'e2e-the-fool-theme-' + Date.now(),
      name: 'E2E The Fool Theme',
      assistant: { id: assistantId },
      extra: { workspace: 'C:\\tmp', custom_workspace: true, session_mode: 'default' },
    });

    try {
      await page.evaluate(
        ({ conversationId, storageKey }) => window.sessionStorage.setItem(storageKey, conversationId),
        { conversationId: conversation.id, storageKey: STREAM_INJECTOR_CONVERSATION_KEY }
      );
      await page.goto(page.url().split('#')[0] + '#/conversation/' + conversation.id);
      await expect(page.getByTestId('message-list-scroller')).toBeVisible({ timeout: 30_000 });
      await page.waitForFunction((conversationId) => {
        const registry = (window as unknown as { __AIONUI_E2E_MESSAGE_STREAM__?: StreamRegistry })
          .__AIONUI_E2E_MESSAGE_STREAM__;
        return Boolean(registry?.controllers[conversationId]);
      }, conversation.id);
      await page.evaluate(async (conversationId) => {
        const registry = (window as unknown as { __AIONUI_E2E_MESSAGE_STREAM__?: StreamRegistry })
          .__AIONUI_E2E_MESSAGE_STREAM__;
        await registry!.controllers[conversationId].runScenario({ historyPairs: 1, lines: 0, seedHistoryOnly: true });
      }, conversation.id);

      const message = page.getByTestId('message-text-content').filter({ hasText: 'User seed message 1' }).last();
      await expect(message).toBeVisible();
      const messageSurface = await message.evaluate((content) => {
        const bubble = content.closest<HTMLElement>('.bg-aou-2');
        if (!bubble) throw new Error('Expected the user message to render in its themed chat bubble.');
        return {
          surface: getComputedStyle(bubble).backgroundColor,
          text: getComputedStyle(bubble).color,
        };
      });

      expect(contrastRatio(messageSurface.text, messageSurface.surface)).toBeGreaterThanOrEqual(4.5);
    } finally {
      await page.evaluate(
        (storageKey) => window.sessionStorage.removeItem(storageKey),
        STREAM_INJECTOR_CONVERSATION_KEY
      );
      await httpDelete(page, '/api/conversations/' + encodeURIComponent(conversation.id)).catch(() => {});
    }
  });

  test('lets an existing profile opt out and preserves that choice after reload', async ({ page }) => {
    await navigateTo(page, '#/settings/appearance');

    const lightThemeCard = page
      .locator('.grid > div.cursor-pointer')
      .filter({ has: page.getByText('Light', { exact: true }) })
      .first();
    await expect(lightThemeCard).toBeVisible();
    await lightThemeCard.click();

    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');
    await page.reload();
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'light');
  });
});
