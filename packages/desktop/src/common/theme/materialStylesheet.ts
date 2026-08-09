/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The material, written into the tokens the whole application already reads.
 *
 * The first attempt at this published `--fool-*` variables and a `.fool-surface`
 * class, and the application went on looking exactly as it had. That was the
 * lesson: almost nothing on screen is a `div` somebody can add a class to. It is
 * Arco's card, Arco's button, Arco's dropdown, a sidebar built from `bg-base`
 * and `border-base`, a hundred utility classes pointing at `--bg-2`. A material
 * that only reaches the elements someone remembered to tag is a material that
 * changes six boxes and leaves the app behind them.
 *
 * So the derived palette is expanded here into the app's own token families —
 * the same ones a theme preset writes — and every component follows without
 * knowing this file exists. `themeOverrides.ts` already does exactly this for a
 * single accent colour; this is the same idea with a whole palette behind it.
 *
 * Pure, and free of the DOM, so it can be tested by reading the text it makes.
 *
 * **`!important` on every declaration, and the sheet goes last.** Theme presets
 * are injected through the custom-CSS processor, which stamps `!important` onto
 * everything it finds. Anything without it loses to whichever preset is on.
 *
 * **No animation shorthand here, ever.** The same processor's rewrite voids the
 * keyframes an animation names. The breathing ground, the sheen and the pulse
 * live in `materials.css`, which is a real stylesheet nothing rewrites.
 */

import { colorVariables, parseHexColor } from '@/common/config/themeOverrides';
import { defaultSurfaceBackground, hasBackgroundImage, type SurfaceBackground } from '@/common/theme/surfaceBackground';
import { resolveTokens, type SurfaceStyleChoice } from '@/common/theme/surfaceChoice';
import { derivePalette, effectiveAlpha, isDark, surfaceVariables, type Palette } from '@/common/theme/surfaceStyle';

type Entry = readonly [string, string];

const clamp = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

/** `a` moved `amount` of the way towards `b`. Both are `#rrggbb`. */
const mix = (a: string, b: string, amount: number): string => {
  const from = parseHexColor(a);
  const to = parseHexColor(b);
  if (!from || !to) return a;
  const channel = (x: number, y: number): string =>
    clamp(x + (y - x) * amount)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(from.red, to.red)}${channel(from.green, to.green)}${channel(from.blue, to.blue)}`;
};

/**
 * The grey ramp, built between the two colours that were actually derived.
 *
 * Every step is the ground moved towards the ink, so the ramp is coherent for
 * any accent and lands the right way round in a dark room without anybody
 * having to ask which way round it is.
 */
const ramp = (palette: Palette): Entry[] => {
  const { ground, card, ink, inkSoft } = palette;
  const step = (amount: number): string => mix(card, ink, amount);

  return [
    ['--color-bg-base', ground],
    ['--bg-base', ground],
    ['--color-bg-1', card],
    ['--bg-1', card],
    ['--color-bg-2', step(0.04)],
    ['--bg-2', step(0.04)],
    ['--color-bg-3', step(0.1)],
    ['--bg-3', step(0.1)],
    ['--color-bg-4', step(0.22)],
    ['--bg-4', step(0.22)],
    ['--color-bg-5', step(0.34)],
    ['--bg-5', step(0.34)],
    // `text-t-tertiary` is `--bg-6`, which is why a grey step has to be a text
    // colour: it is the hint text under half the controls in the application.
    ['--bg-6', inkSoft],
    ['--bg-8', step(0.72)],
    ['--bg-9', step(0.88)],
    ['--bg-10', ink],
    ['--bg-hover', step(0.07)],
    ['--bg-active', step(0.14)],
    ['--fill', card],
    ['--color-fill', card],
    ['--fill-0', card],
    ['--dialog-fill-0', card],
    ['--color-fill-1', step(0.05)],
    ['--color-fill-2', step(0.09)],
    ['--color-fill-3', step(0.15)],
    ['--color-fill-4', step(0.22)],
    ['--workspace-btn-bg', step(0.05)],
    ['--color-guid-agent-bar', card],
    ['--message-user-bg', mix(card, palette.accent, 0.14)],
    ['--message-tips-bg', mix(card, palette.accent, 0.07)],

    ['--color-text-1', ink],
    ['--text-primary', ink],
    ['--text-0', ink],
    ['--color-text-2', mix(ink, ground, 0.22)],
    ['--text-secondary', mix(ink, ground, 0.22)],
    ['--color-text-3', inkSoft],
    ['--color-text-4', mix(ink, ground, 0.55)],
    ['--text-disabled', mix(ink, ground, 0.55)],

    ['--color-border', mix(ground, ink, 0.14)],
    ['--color-border-1', mix(ground, ink, 0.14)],
    ['--color-border-2', mix(ground, ink, 0.08)],
    ['--color-border-3', mix(ground, ink, 0.22)],
    ['--color-border-4', mix(ground, ink, 0.32)],
    ['--border-base', mix(ground, ink, 0.14)],
    ['--border-light', mix(ground, ink, 0.08)],
    ['--border-special', mix(ground, ink, 0.2)],
  ];
};

/**
 * Every token the material sets, as pairs.
 *
 * The `--fool-*` half is what `materials.css` selects on; the rest is the
 * application's own vocabulary, which is what makes the sidebar, the dropdowns
 * and the buttons move with it.
 */
export const materialTokens = (choice: SurfaceStyleChoice, prefersDark: boolean): readonly Entry[] => {
  const tokens = resolveTokens(choice);
  const dark = isDark(choice.style, prefersDark);
  const palette = derivePalette(choice.accent, choice.style, prefersDark, tokens.tint);

  return [
    ...surfaceVariables(choice.style, tokens, palette),
    // The corner belongs to the material now, and this is the name every rule
    // reads it by — including the ones in `materials.css`, which declares its
    // own fallback for an application wearing no material.
    ['--fool-radius-material', `${tokens.radius}px`],
    ['--fool-radius', `${tokens.radius}px`],
    ['--fool-radius-sm', `${Math.round(tokens.radius * 0.5)}px`],
    ['--fool-radius-lg', `${Math.round(tokens.radius * 1.5)}px`],
    ['--fool-radius-pill', tokens.radius === 0 ? '0px' : '999px'],
    ['color-scheme', dark ? 'dark' : 'light'],
    ...colorVariables('primary', palette.accent),
    ...ramp(palette),
  ];
};

const ROOT_SELECTORS = [
  ':root',
  "[data-theme='dark']",
  "[data-theme='light']",
  "body[arco-theme='dark']",
  "body[arco-theme='light']",
].join(',\n');

/**
 * Components that are a surface, and components that sit on one.
 *
 * Two lists rather than one because they want different things from the same
 * material: a card wants the full recipe — the ground, the shadow, the blur —
 * and an input wants the corner and the line and to stay legible. A text field
 * with a neumorphic drop shadow is a text field nobody can see the caret in.
 */
const SURFACES = [
  '.arco-card',
  '.arco-modal',
  '.arco-drawer',
  '.arco-popover-content',
  '.arco-dropdown-menu',
  '.arco-select-popup',
  '.arco-message',
  '.arco-notification',
  '.arco-tooltip-content',
  '.arco-picker-container',
].join(',\n');

const CONTROLS = [
  '.arco-btn',
  '.arco-input-wrapper',
  '.arco-textarea',
  '.arco-select-view',
  '.arco-tag',
  '.arco-input-tag',
  '.arco-collapse-item-header',
  '.arco-pagination-item',
].join(',\n');

/**
 * A picture behind the application, under the material's own light.
 *
 * Three layers, and the order is the whole trick. The picture goes on `body` in
 * a fixed pseudo-element so it stays put while a page scrolls and cannot be
 * clipped by whichever container happens to scroll. `#root` sits over it
 * carrying two things: the material's own wash — the gradients that make glass
 * glass — and a scrim of the ground at whatever opacity was *not* asked for.
 * At full opacity the scrim vanishes and the photograph is the app; at zero it
 * is opaque and the picture is gone. The blur is a real blur on the picture
 * rather than a `backdrop-filter` on the root, because the second makes the
 * application's root a containing block and quietly breaks everything fixed
 * inside it.
 */
const backgroundLayer = (choice: SurfaceStyleChoice, prefersDark: boolean, background: SurfaceBackground): string => {
  const tokens = resolveTokens(choice);
  const { ground } = derivePalette(choice.accent, choice.style, prefersDark, tokens.tint);
  const channels = parseHexColor(ground);
  const veil = channels
    ? `rgb(${channels.red} ${channels.green} ${channels.blue} / ${(1 - background.opacity).toFixed(3)})`
    : 'transparent';
  // The picture is grown by the blur radius on every side, so a blurred edge is
  // never a visible border of grey.
  const bleed = Math.max(0, Math.round(background.blur * 2.5));

  return `body::before {
  content: '';
  position: fixed;
  inset: -${bleed}px;
  z-index: 0;
  background-image: url("${background.image}");
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  filter: blur(${background.blur}px);
  pointer-events: none;
}

#root {
  position: relative;
  z-index: 1;
  background:
    var(--fool-page-wash, none),
    linear-gradient(${veil}, ${veil}) !important;
  color: var(--fool-ink) !important;
}`;
};

/**
 * The whole material, as a stylesheet.
 *
 * @param choice what is being worn
 * @param prefersDark whether the document says the room is dark
 * @param background the picture behind it, if there is one
 */
export const materialStylesheet = (
  choice: SurfaceStyleChoice,
  prefersDark: boolean,
  background: SurfaceBackground = defaultSurfaceBackground()
): string => {
  const tokens = resolveTokens(choice);
  const alpha = effectiveAlpha(choice.style, tokens.alpha);
  const picture = hasBackgroundImage(background) ? backgroundLayer(choice, prefersDark, background) : '';
  const declarations = materialTokens(choice, prefersDark)
    .map(([name, value]) => `  ${name}: ${value} !important;`)
    .join('\n');

  return [
    `${ROOT_SELECTORS} {\n${declarations}\n}`,

    // The ground goes on exactly one element. Painting the same translucent
    // wash onto `html`, `body` and `#root` stacks it three times, and three
    // coats of a 55% accent over the whole window is the stain the first
    // version of this put behind everything.
    `html, body {
  background: var(--fool-ground) !important;
  color: var(--fool-ink) !important;
}`,

    picture ||
      `#root {
  background: var(--fool-page-bg) !important;
  color: var(--fool-ink) !important;
}`,

    `${SURFACES} {
  background: var(--fool-surface-bg) !important;
  border: var(--fool-surface-border) !important;
  border-radius: var(--fool-radius-material) !important;
  box-shadow: var(--fool-surface-shadow) !important;
  color: var(--fool-ink) !important;
}`,

    // Blur is what tells glass from plain, and it is worth nothing on a surface
    // with an opaque background — so it is set only where it can be seen.
    alpha < 1 && tokens.blur > 0
      ? `${SURFACES} {
  backdrop-filter: blur(${tokens.blur}px) saturate(${100 + tokens.saturation}%) !important;
  -webkit-backdrop-filter: blur(${tokens.blur}px) saturate(${100 + tokens.saturation}%) !important;
}`
      : '',

    `${CONTROLS} {
  border-radius: var(--fool-radius-material) !important;
  border-color: var(--color-border-1) !important;
}`,

    // Movement, on the components the application is actually built from.
    //
    // `lift`, `press` and `bounce` used to reach `.fool-surface` alone, which is
    // a handful of hand-tagged elements — so on nine screens out of ten those
    // three sliders moved a number and nothing else. A dial that does nothing is
    // worse than a missing one: the user drags it, sees nothing, and stops
    // trusting the rest of the page.
    `${CONTROLS},
${SURFACES} {
  transition:
    transform var(--fool-motion, 220ms) var(--fool-ease-material, ease),
    box-shadow var(--fool-motion, 220ms) ease,
    border-color var(--fool-motion, 220ms) ease;
}`,

    tokens.lift > 0
      ? `.arco-card:hover,
.arco-btn:hover:not(:disabled),
.arco-tag:hover {
  transform: translateY(calc(var(--fool-lift) * -0.6)) !important;
}`
      : '',

    tokens.press > 0
      ? `.arco-btn:active:not(:disabled),
.arco-card:active {
  transform: translateY(var(--fool-press)) !important;
}`
      : '',

    // What goes on the accent is decided by contrast, not by Arco's assumption
    // that white always works. It does not: on a yellow accent it disappears.
    `.arco-btn-primary,
.arco-btn-primary:hover,
.arco-btn-primary:focus {
  background-color: var(--fool-accent) !important;
  color: var(--fool-on-accent) !important;
  border-color: transparent !important;
}`,

    // Colour only, and no background. A blanket `background-color !important`
    // here painted over every button that carries its own — which is what wiped
    // the nine colour swatches in the picker and left a row of empty rings.
    `.arco-btn-secondary:not([style*='background']),
.arco-btn-default:not([style*='background']) {
  background-color: var(--color-fill-2) !important;
}`,

    `.arco-btn-secondary,
.arco-btn-default,
.arco-btn-text {
  color: var(--fool-ink) !important;
}`,

    // The frame the pages sit in. A sidebar still wearing the old grey while
    // every page behind it has changed is the single most visible way for this
    // to look broken.
    `.arco-layout,
.arco-layout-sider,
.arco-layout-header,
.arco-layout-content,
.arco-layout-footer {
  background: transparent !important;
  color: var(--fool-ink) !important;
}`,

    `.arco-divider,
.arco-menu-item::after {
  border-color: var(--color-border-2) !important;
}`,

    // Scrollbars are painted by the engine from `color-scheme`, and the one
    // place a light bar on a dark aurora would show.
    `* {
  scrollbar-color: var(--color-border-3) transparent;
}`,
  ]
    .filter(Boolean)
    .join('\n\n');
};
