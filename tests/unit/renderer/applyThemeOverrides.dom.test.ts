/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyThemeOverrides,
  reassertThemeOverrides,
  restackThemeStyles,
} from '@renderer/utils/theme/applyThemeOverrides';

const overrideStyle = () => document.getElementById('theme-overrides');

/** Stands in for a theme preset, which arrives with `!important` attached. */
const injectPreset = () => {
  const preset = document.createElement('style');
  preset.id = 'theme-decoration';
  preset.textContent = `:root { --color-primary: #c4123f !important; }\nhtml, body { background-color: #0b0d10 !important; }`;
  document.head.appendChild(preset);
  return preset;
};

const injectMaterial = () => {
  const material = document.createElement('style');
  material.id = 'fool-material';
  material.textContent = ':root { --color-bg-1: #101014 !important; }';
  document.head.appendChild(material);
  return material;
};

/**
 * This module used to publish four hand-picked colours over everything else.
 *
 * They were stored with no idea which appearance was showing, so a ground
 * chosen in the dark kept winning after a switch to light; and they outranked
 * the material, so choosing a material visibly failed to move most of the
 * interface. Colour is a palette now — a closed list, every member checked
 * against every material in both appearances — and this layer has nothing left
 * to say.
 *
 * What it still does is restack, because every theme change ends on this call.
 */
describe('applyThemeOverrides', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.documentElement.removeAttribute('style');
  });

  it('writes nothing at all when no colour has been chosen', () => {
    applyThemeOverrides({ colors: {} });

    expect(overrideStyle()).toBeNull();
  });

  it('writes nothing even for colours somebody stored before the picker went', () => {
    applyThemeOverrides({ colors: { primary: '#123456', background: '#654321', surface: '#abcdef', text: '#fedcba' } });

    expect(overrideStyle()).toBeNull();
  });

  it('leaves the window shell to the material rather than repainting it', () => {
    injectPreset();
    applyThemeOverrides({ colors: { background: '#123456' } });

    expect(overrideStyle()).toBeNull();
    expect(document.documentElement.getAttribute('style')).toBeNull();
  });

  it('still puts the material above the preset when re-asserted', () => {
    injectPreset();
    injectMaterial();
    reassertThemeOverrides();

    const ids = [...document.head.querySelectorAll('style[id]')].map((element) => element.id);
    expect(ids.indexOf('fool-material')).toBeGreaterThan(ids.indexOf('theme-decoration'));
  });

  it('restacks without inventing a layer of its own', () => {
    injectMaterial();
    injectPreset();
    restackThemeStyles();

    const ids = [...document.head.querySelectorAll('style[id]')].map((element) => element.id);
    expect(ids).toEqual(['theme-decoration', 'fool-material']);
  });
});
