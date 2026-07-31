/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState } from 'react';

/**
 * Where a pending permission or question card should be shown.
 *
 * The card used to render inline among the messages, which meant it scrolled
 * away — and the 1/2/3 keys kept working on something no longer on screen.
 * Chats provide a dock directly above the composer and the card paints into it
 * instead, so the thing waiting on an answer is always where the answer gets
 * typed.
 *
 * `null` means no dock on this surface, and the card falls back to rendering
 * where it sits. Team and preview surfaces have no composer to dock to.
 */
const PermissionDockContext = createContext<HTMLElement | null>(null);

export const usePermissionDock = (): HTMLElement | null => useContext(PermissionDockContext);

/**
 * Renders the dock and puts its node on the context.
 *
 * State, not a ref: the node has to be on the context during the commit that
 * children read it in, and a ref assignment does not re-render them.
 */
export const PermissionDock: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [node, setNode] = useState<HTMLElement | null>(null);

  return (
    <PermissionDockContext.Provider value={node}>
      {children}
      <div ref={setNode} className='permission-dock' data-testid='permission-dock' />
    </PermissionDockContext.Provider>
  );
};
