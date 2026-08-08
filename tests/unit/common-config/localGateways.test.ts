/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  LOCAL_GATEWAYS,
  gatewayById,
  orderGateways,
  probeUrlFor,
  stateFor,
  type GatewayState,
  type LocalGatewayId,
} from '@/common/config/localGateways';

describe('the gateway table', () => {
  it('knows where OmniRoute listens, so nobody has to type it', () => {
    // A port nobody can be expected to know, wrong in a way that produces no
    // error — just a provider that never lists a model.
    const omniroute = gatewayById('omniroute');

    expect(omniroute?.baseUrl).toBe('http://127.0.0.1:20128/v1');
    expect(omniroute?.install).toContain('omniroute');
  });

  it('gives every gateway an address, a reason and a way to get it', () => {
    for (const gateway of LOCAL_GATEWAYS) {
      expect(gateway.baseUrl, gateway.id).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/);
      expect(gateway.what.length, gateway.id).toBeGreaterThan(20);
      expect(gateway.install.length, gateway.id).toBeGreaterThan(10);
      expect(gateway.docs, gateway.id).toMatch(/^https:\/\//);
      // A provider row with an empty key field looks broken even when the
      // endpoint takes anything.
      expect(gateway.placeholderKey.length, gateway.id).toBeGreaterThan(0);
    }
  });

  it('probes the models list rather than the root', () => {
    expect(probeUrlFor(gatewayById('omniroute')!)).toBe('http://127.0.0.1:20128/v1/models');
  });
});

describe('stateFor', () => {
  it('separates "up with nothing loaded" from "not there"', () => {
    // The two need opposite advice, and told the wrong one somebody reinstalls
    // software they already have.
    expect(stateFor(true, 3)).toBe('ready');
    expect(stateFor(true, 0)).toBe('running-empty');
    expect(stateFor(false, 0)).toBe('absent');
  });
});

describe('orderGateways', () => {
  it('leads with what already works and keeps the rest visible', () => {
    const found = new Map<LocalGatewayId, GatewayState>([
      ['lm-studio', 'absent'],
      ['omniroute', 'ready'],
      ['ollama', 'running-empty'],
    ]);

    expect(orderGateways(found).map((entry) => entry.gateway.id)).toEqual(['omniroute', 'ollama', 'lm-studio']);
  });

  it('still lists everything when none are installed', () => {
    const order = orderGateways(new Map());

    expect(order).toHaveLength(LOCAL_GATEWAYS.length);
    expect(order.every((entry) => entry.state === 'absent')).toBe(true);
  });
});
