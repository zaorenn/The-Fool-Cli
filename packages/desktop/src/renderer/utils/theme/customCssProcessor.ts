/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Preparing a theme's stylesheet for injection.
 *
 * A theme has to outrank the application's own styles or it changes nothing, so
 * every declaration in it is marked `!important` on the way in. That is the
 * whole mechanism, and it has to be done by reading the CSS rather than by
 * matching text.
 *
 * The first version matched `property: value;` with a regular expression, which
 * cannot tell a declaration from the colon in a selector. `.btn:hover` became
 * `.btn: hover`, an invalid selector the browser drops along with the rule
 * inside it — so hover states, `::before` decoration and scrollbar styling were
 * silently missing from every theme that had them. The same pattern stopped at
 * the first `;`, which cut `url(data:image/png;base64,…)` in half and broke the
 * theme editor's own cover-image feature.
 *
 * Two kinds of block are walked past rather than marked, because `!important`
 * does not mean "stronger" inside them, it means "ignored":
 *
 *  - `@keyframes` — a keyframe declaration carrying `!important` is dropped by
 *    the browser, which empties the block and kills the animation.
 *  - `@font-face` — its contents are descriptors, not declarations; one
 *    `!important` invalidates the whole block, and the theme's font never loads.
 */

import { parse, type AtRule, type Container, type Declaration } from 'postcss';

/** At-rules whose contents are not declarations that `!important` can strengthen. */
const NON_DECLARATION_AT_RULES = /^(-\w+-)?(keyframes|font-face|property|counter-style|font-feature-values)$/i;

/** Whether this declaration sits inside a block where `!important` would void it. */
const isInsideNonDeclarationAtRule = (declaration: Declaration): boolean => {
  let node: Container | undefined = declaration.parent;
  while (node) {
    if (node.type === 'atrule' && NON_DECLARATION_AT_RULES.test((node as AtRule).name)) return true;
    node = node.parent as Container | undefined;
  }
  return false;
};

/**
 * Marks every declaration in the stylesheet `!important`.
 *
 * Selectors are never touched — this walks the parsed tree, so a colon in
 * `.btn:hover` is part of a selector and a colon in `color: red` is a
 * declaration, and nothing has to guess which is which.
 *
 * Invalid CSS is returned unchanged rather than thrown away: a stylesheet the
 * user is still typing should stop taking effect, not take the theme with it.
 */
export const addImportantToAll = (css: string): string => {
  if (!css || !css.trim()) {
    return '';
  }

  try {
    const root = parse(css);
    root.walkDecls((declaration) => {
      if (declaration.important) return;
      if (isInsideNonDeclarationAtRule(declaration)) return;
      declaration.important = true;
    });
    return root.toString();
  } catch {
    return css;
  }
};

/**
 * 包装自定义 CSS，添加注释说明
 * @param css - 处理后的 CSS 字符串
 * @returns 带注释的 CSS 字符串
 */
export const wrapCustomCss = (css: string): string => {
  if (!css || !css.trim()) {
    return '';
  }

  return `
/* 用户自定义样式 - 自动添加 !important 提升优先级 */
/* User Custom Styles - Auto !important for highest priority */
${css}
  `.trim();
};

/**
 * 完整处理自定义 CSS
 * @param css - 原始 CSS 字符串
 * @returns 处理后并包装的 CSS 字符串
 */
export const processCustomCss = (css: string): string => {
  const processed = addImportantToAll(css);
  return wrapCustomCss(processed);
};

/**
 * Whether this stylesheet parses, and what is wrong with it if not.
 *
 * The previous version counted braces, which passes anything with balanced
 * punctuation and fails nothing a user would actually write by accident. This
 * reports what the parser reports — with the line, so the editor can point at it
 * instead of saying the theme did not apply and leaving the user to guess.
 */
export const validateCss = (css: string): { valid: boolean; error?: string; line?: number } => {
  if (!css || !css.trim()) {
    return { valid: true };
  }

  try {
    parse(css);
    return { valid: true };
  } catch (error) {
    const syntaxError = error as { reason?: string; line?: number; message?: string };
    return {
      valid: false,
      error: syntaxError.reason ?? syntaxError.message ?? 'Invalid CSS',
      line: syntaxError.line,
    };
  }
};
