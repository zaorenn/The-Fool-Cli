/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import MemoryModalContent from '@renderer/components/settings/SettingsModal/contents/memory';

/**
 * The Memory page, which is the Memory tab with a route in front of it.
 *
 * Settings exist twice in this app — as a modal and as a page — and every other
 * section is written once and shown in both. Two editors over one document would
 * be two places for the same text to be wrong.
 */
const MemorySettings: React.FC = () => <MemoryModalContent />;

export default MemorySettings;
