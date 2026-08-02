/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Keeping a theme from taking the whole application with it.
 *
 * Custom theme CSS is injected with `!important` added to every declaration, so
 * it outranks the app's own styles by design — that is what makes theming work
 * at all. It also means one rule like `body { display: none }` blanks the
 * window, and the settings screen that would undo it is inside that window. The
 * user is left with nothing to click.
 *
 * Two defences, because either alone is not enough:
 *
 * - {@link findFatalThemeCss} refuses the rule before it is ever saved, so the
 *   user (or the assistant writing the theme for them) is told what is wrong
 *   instead of finding out by losing the interface.
 * - {@link THEME_SAFETY_NET_CSS} is injected after the theme and asserts that
 *   the document's own elements stay visible. It catches what the check cannot
 *   — a rule phrased in a way no pattern anticipated — because it does not need
 *   to understand the theme, only to outlast it.
 *
 * The net is deliberately narrow. It pins visibility on `html`, `body` and the
 * React root and nothing else, so a theme can still restyle every component
 * inside them, hide individual elements, and look like whatever it likes.
 */

/** The elements that, if hidden, take the entire interface with them. */
const APP_LEVEL_SELECTORS = ['html', 'body', '*', ':root', '#root', '#app'];

/**
 * Declarations that make an element invisible rather than merely restyled.
 *
 * Each entry is the property and the values that amount to "not on screen".
 * Anything else — a colour, a font, a border — is a theme doing its job.
 */
const HIDING_DECLARATIONS: ReadonlyArray<{ property: string; pattern: RegExp }> = [
  { property: 'display', pattern: /^none$/i },
  { property: 'visibility', pattern: /^(hidden|collapse)$/i },
  { property: 'opacity', pattern: /^0(\.0+)?$/ },
  { property: 'transform', pattern: /^scale\(\s*0(\.0+)?\s*\)$/i },
];

/** Strips comments and `@keyframes` blocks, whose zero values are not a resting state. */
const withoutNonBindingBlocks = (css: string): string =>
  css.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\}\s*)*\}/gi, ' ');

/**
 * Rules in this stylesheet that would hide the whole application.
 *
 * Returns a human-readable description of each, so the caller can say which
 * rule it refused rather than rejecting the theme as a whole. An empty array
 * means nothing here can blank the window.
 */
export function findFatalThemeCss(css: string): string[] {
  if (!css || !css.trim()) return [];

  const findings: string[] = [];
  const ruleMatcher = /([^{}]+)\{([^{}]*)\}/g;

  for (const [, rawSelector, body] of withoutNonBindingBlocks(css).matchAll(ruleMatcher)) {
    const selectors = rawSelector
      .split(',')
      .map((selector) => selector.trim().toLowerCase())
      .filter(Boolean);
    // Only a selector that reaches the document itself can blank it. A theme
    // hiding one of its own components is none of this function's business.
    const appLevel = selectors.filter((selector) => APP_LEVEL_SELECTORS.includes(selector));
    if (appLevel.length === 0) continue;

    for (const declaration of body.split(';')) {
      const [rawProperty, ...rest] = declaration.split(':');
      if (rest.length === 0) continue;
      const property = rawProperty.trim().toLowerCase();
      const value = rest
        .join(':')
        .replace(/!important/i, '')
        .trim();

      const hiding = HIDING_DECLARATIONS.find((entry) => entry.property === property && entry.pattern.test(value));
      if (hiding) {
        findings.push(`"${appLevel.join(', ')} { ${property}: ${value} }" would hide the whole window`);
      }
    }
  }

  return findings;
}

/**
 * The last stylesheet in the document, and the one that decides whether
 * anything can be seen.
 *
 * `!important` is not optional here: theme CSS is rewritten to carry it on
 * every declaration, so a net without it would lose to exactly the rules it is
 * meant to survive. Appended after the theme so it also wins on source order.
 *
 * Only visibility is pinned. Colour, spacing, typography and everything else
 * are left entirely to the theme.
 */
export const THEME_SAFETY_NET_CSS = `
/* Applied after every theme. A stylesheet may restyle the application freely;
   it may not make it impossible to see or to click. */
html,
body,
#root {
  display: block !important;
  visibility: visible !important;
  opacity: 1 !important;
  transform: none !important;
  pointer-events: auto !important;
}
`.trim();

/**
 * The same stylesheet with its window-hiding rules taken out.
 *
 * The net above pins the document's own elements, which is enough for a rule
 * aimed at `html` or `body`. It is not enough for `* { display: none }`: that
 * hides everything *inside* the root, so the elements the net protects stay
 * visible and empty, and the user still sees a blank window. There is no
 * selector that can undo a universal rule, so the rule has to go instead.
 *
 * Only the offending declarations are dropped, never the rule around them — a
 * theme that hides the app and also sets a background keeps its background.
 */
export function stripFatalThemeCss(css: string): string {
  if (!css || !css.trim()) return css;

  const ruleMatcher = /([^{}]+)(\{)([^{}]*)(\})/g;

  return css.replace(ruleMatcher, (whole, rawSelector: string, open: string, body: string, close: string) => {
    const selectors = rawSelector
      .split(',')
      .map((selector) => selector.trim().toLowerCase())
      .filter(Boolean);
    if (!selectors.some((selector) => APP_LEVEL_SELECTORS.includes(selector))) return whole;

    const kept = body
      .split(';')
      .filter((declaration) => {
        const [rawProperty, ...rest] = declaration.split(':');
        if (rest.length === 0) return true;
        const property = rawProperty.trim().toLowerCase();
        const value = rest
          .join(':')
          .replace(/!important/i, '')
          .trim();
        return !HIDING_DECLARATIONS.some((entry) => entry.property === property && entry.pattern.test(value));
      })
      .join(';');

    return `${rawSelector}${open}${kept}${close}`;
  });
}
