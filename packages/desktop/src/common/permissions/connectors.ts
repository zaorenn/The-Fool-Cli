/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Decision } from './types';

/**
 * What an outside account may be asked to do, before there is an outside
 * account.
 *
 * Mail that can be read and not written is not a feature of a mail connector.
 * It is a *permission model*, and it has to exist before the first connector or
 * the first connector defines it by accident — whichever shape Spotify happens
 * to need becomes the shape mail gets, and the second one is where it is
 * noticed. The whole of this file is here to be written first.
 *
 * It is the same idea as `decide.ts` one level out. That answers "may this tool
 * touch this path"; this answers "may this service be asked this kind of
 * question at all", and the two differ in one way that matters: a tool the
 * rules have never heard of defaults to **ask**, because it is running on the
 * user's own machine and they can see what it did. A *capability* nobody
 * declared defaults to **deny**, because there is no such thing — a connector
 * asking for it is a connector asking for something it never said it wanted,
 * and the honest answer to that is no rather than a question the user has no
 * way to judge.
 *
 * Read and write are separate answers. Never derived from one another, in
 * either direction: "you let me read your mail" is not consent to send any, and
 * the reverse is not consent to read the rest of the inbox.
 */

/** Which half of a service one capability is about. */
export type CapabilityAccess = 'read' | 'write';

/** One thing a connector says it wants to be able to do. */
export type ConnectorCapability = {
  /** Stable, and part of the stored grant, so renaming one revokes it. */
  id: string;
  access: CapabilityAccess;
};

/** A service that can be connected, and everything it will ever ask for. */
export type ConnectorSpec = {
  id: string;
  label: string;
  capabilities: readonly ConnectorCapability[];
};

/** One answer the user has given, for one capability of one connector. */
export type ConnectorGrant = {
  connector: string;
  capability: string;
  /** False is a refusal that has been given, which is not the same as silence. */
  granted: boolean;
};

/** What is being asked of a service right now. */
export type ConnectorCall = { connector: string; capability: string };

/** Where the answers are kept. */
export const CONNECTOR_GRANTS_CONFIG_KEY = 'connectors.grants';

/**
 * The services that exist, and what each of them declares.
 *
 * Data rather than code because the interesting part is per-service and small,
 * and because adding one should be adding a row. Nothing here connects
 * anything: this is the list of what *could* be asked for, which is exactly
 * what the user is being asked to answer about.
 */
export const CONNECTORS: readonly ConnectorSpec[] = [
  {
    id: 'spotify',
    label: 'Spotify',
    capabilities: [
      // What is playing, and on what. Reading this is how "play it on the
      // kitchen speaker" finds the speaker.
      { id: 'playback.read', access: 'read' },
      // Starting, pausing, skipping. The thing people actually ask for, and
      // separately answerable from being able to see the library.
      { id: 'playback.control', access: 'write' },
      { id: 'library.read', access: 'read' },
      // Adding to a playlist changes something the user keeps.
      { id: 'library.write', access: 'write' },
    ],
  },
  {
    id: 'mail',
    label: 'Mail',
    capabilities: [
      { id: 'messages.read', access: 'read' },
      // The one this whole file exists for. Nothing about being able to read a
      // mailbox says anything about being allowed to send from it.
      { id: 'messages.send', access: 'write' },
      { id: 'drafts.write', access: 'write' },
    ],
  },
];

/** One connector by id, or nothing when it is not a service that exists. */
export const connectorSpec = (id: string, catalogue: readonly ConnectorSpec[] = CONNECTORS): ConnectorSpec | null =>
  catalogue.find((connector) => connector.id === id) ?? null;

/** One capability of one connector, or nothing when it was never declared. */
export const connectorCapability = (
  call: ConnectorCall,
  catalogue: readonly ConnectorSpec[] = CONNECTORS
): ConnectorCapability | null =>
  connectorSpec(call.connector, catalogue)?.capabilities.find((capability) => capability.id === call.capability) ??
  null;

/**
 * What may happen to this request of an outside account.
 *
 * Four answers to four different situations, and the difference between the
 * first two is the point of the whole file:
 *
 * - a service nobody has heard of → **deny**. There is nothing to grant.
 * - a capability the connector never declared → **deny**. It is asking for
 *   something outside what it told the user it wanted, and no answer the user
 *   gave can cover it. This is the line "a tool call that exceeds what was
 *   granted is refused by the layer rather than by the connector's own good
 *   manners" turned into code.
 * - declared, and refused → **deny**.
 * - declared, and not yet answered → **ask**.
 * - declared, and granted → **allow**.
 */
export const decideConnectorCall = (
  grants: readonly ConnectorGrant[],
  call: ConnectorCall,
  catalogue: readonly ConnectorSpec[] = CONNECTORS
): Decision => {
  if (!connectorCapability(call, catalogue)) return 'deny';

  const answer = grants.find((grant) => grant.connector === call.connector && grant.capability === call.capability);
  if (!answer) return 'ask';
  return answer.granted ? 'allow' : 'deny';
};

/** Whether one capability has been granted, for anything drawing switches. */
export const isGranted = (grants: readonly ConnectorGrant[], call: ConnectorCall): boolean =>
  grants.some((grant) => grant.connector === call.connector && grant.capability === call.capability && grant.granted);

/**
 * Records one answer, replacing whatever was said about it before.
 *
 * One capability at a time, deliberately. A single "connect Spotify" switch is
 * the design this exists instead of: it is one click, it is what everybody
 * ships, and it is how somebody ends up having agreed to let an assistant write
 * to a playlist they have kept for ten years.
 */
export const answerCapability = (
  grants: readonly ConnectorGrant[],
  call: ConnectorCall,
  granted: boolean,
  catalogue: readonly ConnectorSpec[] = CONNECTORS
): ConnectorGrant[] => {
  // An answer about something that was never declared is not stored. Otherwise
  // a connector could be granted a capability by a stale config file the moment
  // it declares it later.
  if (!connectorCapability(call, catalogue)) return [...grants];

  const others = grants.filter(
    (grant) => !(grant.connector === call.connector && grant.capability === call.capability)
  );
  return [...others, { connector: call.connector, capability: call.capability, granted }];
};

/** Withdraws every answer about one connector, for disconnecting it. */
export const forgetConnector = (grants: readonly ConnectorGrant[], connector: string): ConnectorGrant[] =>
  grants.filter((grant) => grant.connector !== connector);

/**
 * The stored answers as they can be trusted.
 *
 * Anything naming a capability that no longer exists is dropped rather than
 * kept: a grant that outlives the thing it was about is a grant nobody can
 * read, and it would silently come back into force if the id were reused.
 */
export const sanitizeConnectorGrants = (
  value: unknown,
  catalogue: readonly ConnectorSpec[] = CONNECTORS
): ConnectorGrant[] => {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const kept: ConnectorGrant[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') continue;
    const record = entry as { connector?: unknown; capability?: unknown; granted?: unknown };
    if (typeof record.connector !== 'string' || typeof record.capability !== 'string') continue;
    if (typeof record.granted !== 'boolean') continue;

    const call = { connector: record.connector, capability: record.capability };
    if (!connectorCapability(call, catalogue)) continue;

    const key = `${call.connector}/${call.capability}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ ...call, granted: record.granted });
  }
  return kept;
};
