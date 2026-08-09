/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  answerCapability,
  CONNECTORS,
  connectorCapability,
  decideConnectorCall,
  forgetConnector,
  isGranted,
  sanitizeConnectorGrants,
  type ConnectorGrant,
  type ConnectorSpec,
} from '@/common/permissions/connectors';

/**
 * The permission model for an outside account, written before the account.
 *
 * Mail that can be read and not written is not a feature of a mail connector —
 * it is a permission model, and it has to exist before the first connector or
 * the first connector defines it by accident.
 */

/** A pretend service, so these tests do not depend on what ships. */
const catalogue: readonly ConnectorSpec[] = [
  {
    id: 'mail',
    label: 'Mail',
    capabilities: [
      { id: 'messages.read', access: 'read' },
      { id: 'messages.send', access: 'write' },
    ],
  },
];

const granted = (capability: string): ConnectorGrant[] => [{ connector: 'mail', capability, granted: true }];

describe('what an outside account may be asked', () => {
  it('asks when the capability was declared and never answered', () => {
    expect(decideConnectorCall([], { connector: 'mail', capability: 'messages.read' }, catalogue)).toBe('ask');
  });

  it('allows what was granted', () => {
    expect(
      decideConnectorCall(granted('messages.read'), { connector: 'mail', capability: 'messages.read' }, catalogue)
    ).toBe('allow');
  });

  it('denies what was refused, which is not the same as never having been asked', () => {
    const refused: ConnectorGrant[] = [{ connector: 'mail', capability: 'messages.read', granted: false }];
    expect(decideConnectorCall(refused, { connector: 'mail', capability: 'messages.read' }, catalogue)).toBe('deny');
  });

  /**
   * The line the whole file exists for. Reading a mailbox says nothing about
   * being allowed to send from it, and no amount of one implying the other is
   * something the user agreed to.
   */
  it('never lets a read grant answer for a write', () => {
    expect(
      decideConnectorCall(granted('messages.read'), { connector: 'mail', capability: 'messages.send' }, catalogue)
    ).toBe('ask');
  });

  it('never lets a write grant answer for a read either', () => {
    expect(
      decideConnectorCall(granted('messages.send'), { connector: 'mail', capability: 'messages.read' }, catalogue)
    ).toBe('ask');
  });

  /**
   * "Refused by the layer rather than by the connector's own good manners."
   * A capability nobody declared is not something the user can have answered,
   * so the answer is no rather than a question they have no way to judge.
   */
  it('refuses a capability the connector never declared', () => {
    expect(decideConnectorCall([], { connector: 'mail', capability: 'account.delete' }, catalogue)).toBe('deny');
  });

  it('refuses a service that does not exist', () => {
    expect(decideConnectorCall([], { connector: 'telepathy', capability: 'messages.read' }, catalogue)).toBe('deny');
  });

  /// A grant naming an undeclared capability must not become force later.
  it('refuses an undeclared capability even with a grant sitting there for it', () => {
    const stale: ConnectorGrant[] = [{ connector: 'mail', capability: 'account.delete', granted: true }];
    expect(decideConnectorCall(stale, { connector: 'mail', capability: 'account.delete' }, catalogue)).toBe('deny');
  });
});

describe('recording the answers', () => {
  it('keeps one answer per capability rather than a second row', () => {
    let grants = answerCapability([], { connector: 'mail', capability: 'messages.read' }, true, catalogue);
    grants = answerCapability(grants, { connector: 'mail', capability: 'messages.read' }, false, catalogue);

    expect(grants).toEqual([{ connector: 'mail', capability: 'messages.read', granted: false }]);
  });

  it('will not record an answer about something never declared', () => {
    expect(answerCapability([], { connector: 'mail', capability: 'account.delete' }, true, catalogue)).toEqual([]);
  });

  it('answers whether a capability is on, for whatever is drawing the switch', () => {
    expect(isGranted(granted('messages.send'), { connector: 'mail', capability: 'messages.send' })).toBe(true);
    expect(isGranted(granted('messages.send'), { connector: 'mail', capability: 'messages.read' })).toBe(false);
  });

  it('withdraws everything about one service when it is disconnected', () => {
    const grants: ConnectorGrant[] = [
      { connector: 'mail', capability: 'messages.read', granted: true },
      { connector: 'spotify', capability: 'playback.read', granted: true },
    ];

    expect(forgetConnector(grants, 'mail')).toEqual([
      { connector: 'spotify', capability: 'playback.read', granted: true },
    ]);
  });
});

describe('reading grants that may not be grants', () => {
  it('drops anything naming a capability that no longer exists', () => {
    const stored = [
      { connector: 'mail', capability: 'messages.read', granted: true },
      { connector: 'mail', capability: 'a.capability.we.removed', granted: true },
      { connector: 'gone', capability: 'messages.read', granted: true },
    ];

    expect(sanitizeConnectorGrants(stored, catalogue)).toEqual([
      { connector: 'mail', capability: 'messages.read', granted: true },
    ]);
  });

  it('drops anything that is not an answer at all', () => {
    const stored = [{ connector: 'mail', capability: 'messages.read' }, 'yes', null, 42];
    expect(sanitizeConnectorGrants(stored, catalogue)).toEqual([]);
  });

  it('treats anything that is not a list as no answers given', () => {
    expect(sanitizeConnectorGrants(undefined, catalogue)).toEqual([]);
    expect(sanitizeConnectorGrants({ mail: true }, catalogue)).toEqual([]);
  });
});

describe('the services that ship', () => {
  /// Spotify first because it is the smaller surface, and mail because it is
  /// the one the read/write split was written for.
  it('declares both halves of Spotify separately', () => {
    expect(connectorCapability({ connector: 'spotify', capability: 'playback.read' })?.access).toBe('read');
    expect(connectorCapability({ connector: 'spotify', capability: 'playback.control' })?.access).toBe('write');
  });

  it('declares sending mail as a write, apart from reading it', () => {
    expect(connectorCapability({ connector: 'mail', capability: 'messages.read' })?.access).toBe('read');
    expect(connectorCapability({ connector: 'mail', capability: 'messages.send' })?.access).toBe('write');
  });

  it('gives every capability an access and a unique id', () => {
    for (const connector of CONNECTORS) {
      const ids = connector.capabilities.map((capability) => capability.id);
      expect(new Set(ids).size, `${connector.id} has a repeated capability id`).toBe(ids.length);
      for (const capability of connector.capabilities) {
        expect(['read', 'write']).toContain(capability.access);
      }
    }
  });

  /// Nothing is granted by shipping. Every one of these starts as a question.
  it('grants nothing by existing', () => {
    for (const connector of CONNECTORS) {
      for (const capability of connector.capabilities) {
        expect(decideConnectorCall([], { connector: connector.id, capability: capability.id })).toBe('ask');
      }
    }
  });
});
