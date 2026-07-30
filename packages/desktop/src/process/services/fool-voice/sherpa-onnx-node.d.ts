/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `sherpa-onnx-node` ships no type declarations. The provider narrows the parts
 * it uses through its own `SherpaModule` interface, so this only needs to stop
 * the import from being implicitly `any`.
 */
declare module 'sherpa-onnx-node';
