/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Õıòø«µáç CDP ÚÇÜÚüôÕÅÑµşäÜäÕ¡İµö¥ÕñäÒÇé
 *
 * Õıòï¼õ©Çõ©¬Õ░Åµ¿íÕØù´╝îµİ»õ©║õ║åÚü┐Õ╝ÇÕ¥¬Ä»õ¥Ø×Áû´╝ÜÚÇÜÚüôÕ£¿ index.ts ÚçîÕÉ»Õè¿´╝î×Çîõ¢┐ö¿Õ«âÜäµİ»
 * applicationBridge.ts´╝îÕÉÄ×ÇàÕÅêµİ»×ó½ index.ts Úù┤µÄÑÕ╝òÕàÑÜäÒÇé×«®õ©ñ×¥╣Úâ¢ÕÅ¬õ¥Ø×Áû×┐Öõ©¬õ©¡½ïµ¿íÕØù´╝î
 * Õ░▒õ©ıÕ┐à×«® bridge ÕÅıÕÉæ import ÕàÑÕÅúµûçõ╗ÂÒÇé
 *
 * Holds the single-target CDP bridge handle. It lives in its own tiny module to avoid a
 * cycle: the bridge is started in index.ts but consumed by applicationBridge.ts, which
 * index.ts itself pulls in. Having both depend on this neutral module means the bridge
 * layer never has to import the entry file.
 */

import type { CdpBridgeHandle } from '../resources/builtinMcp/cdpBridge';

let handle: CdpBridgeHandle | null = null;

export const setCdpBridgeHandle = (next: CdpBridgeHandle | null): void => {
  handle = next;
};

export const getCdpBridgeHandle = (): CdpBridgeHandle | null => handle;
