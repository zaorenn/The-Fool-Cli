/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Fool 基础组件库统一导出 / The Fool base components unified exports
 *
 * 提供所有基础组件和类型的统一导出入口
 * Provides unified export entry for all base components and types
 */

// ==================== 组件导出 / Component Exports ====================

export { default as FoolModal } from './FoolModal';
export { default as FoolCollapse } from './FoolCollapse';
export { default as FoolSelect } from './FoolSelect';
export { default as FoolScrollArea } from './FoolScrollArea';
export { default as FoolSteps } from './FoolSteps';
export { default as FoolSearchInput } from './FoolSearchInput';
export { default as FoolInlineSearchInput } from './FoolInlineSearchInput';

// ==================== 类型导出 / Type Exports ====================

// FoolModal 类型 / FoolModal types
export type {
  ModalSize,
  ModalHeaderConfig,
  ModalFooterConfig,
  ModalContentStyleConfig,
  FoolModalProps,
} from './FoolModal';
export { MODAL_SIZES } from './FoolModal';

// FoolCollapse 类型 / FoolCollapse types
export type { FoolCollapseProps, FoolCollapseItemProps } from './FoolCollapse';

// FoolSelect 类型 / FoolSelect types
export type { FoolSelectProps } from './FoolSelect';

// FoolSteps 类型 / FoolSteps types
export type { FoolStepsProps } from './FoolSteps';

// FoolSearchInput 类型 / FoolSearchInput types
export type { FoolSearchInputProps } from './FoolSearchInput';

// FoolInlineSearchInput 类型 / FoolInlineSearchInput types
export type { FoolInlineSearchInputProps } from './FoolInlineSearchInput';
