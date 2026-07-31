/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { shouldGreetOnFirstRun } from '@/renderer/pages/guid/hooks/useFirstRunSetup';

describe('first-run greeting decision', () => {
  it('greets a fresh install with nothing configured', () => {
    expect(shouldGreetOnFirstRun(undefined, 0)).toBe(true);
  });

  it('never greets twice', () => {
    // The flag is the guard against onboarding reappearing after the user
    // deletes their last provider.
    expect(shouldGreetOnFirstRun(true, 0)).toBe(false);
  });

  it('does not greet someone who upgraded in with a working setup', () => {
    // Existing users reach this build with the flag unset. Dropping them into
    // onboarding would look like their configuration was lost.
    expect(shouldGreetOnFirstRun(undefined, 3)).toBe(false);
  });

  it('treats an explicit false flag as not yet greeted', () => {
    expect(shouldGreetOnFirstRun(false, 0)).toBe(true);
  });
});
